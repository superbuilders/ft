import { StringDecoder } from 'node:string_decoder'

import { isContextOverflow } from '@earendil-works/pi-ai/utils/overflow'

import { emptyProgress } from '../../project/runs/store'
import { ACCEPTED_DISPOSITIONS, BRIEF_COMMAND_ID, UNRECORDED_EVENTS } from './constants'
import { textOf, track } from './progress'

import type { AssistantMessage } from '@earendil-works/pi-ai'

import type { Progress } from '../../project/runs/types'
import type { JudgeState, Verdict } from './types'

/**
 * Initialize a protocol judge without accepting streamed deltas as an answer.
 * @param progress - the record to keep current, such as the run's live status
 * @returns new judge state
 */
export function createJudge(progress: Progress = emptyProgress()): JudgeState {
    return {
        accepted: false,
        started: false,
        settled: false,
        aborted: false,
        stopReason: null,
        text: '',
        lastText: '',
        modelError: null,
        contextOverflow: false,
        protocolError: null,
        retryCount: 0,
        compactionCount: 0,
        toolErrorCount: 0,
        progress,
        pending: new Map(),
    }
}

/**
 * Consume one authoritative record: a session event, or Pi's response to a command ft sent.
 * @param state - mutable run judge
 * @param line - one LF-delimited record
 * @param observe - sees every well-formed record after the judge
 * @returns whether the run's visible progress changed, and the record's type if it had one; failures are recorded in state
 */
function record(
    state: JudgeState,
    line: string,
    observe: (event: Record<string, unknown>) => void,
): { changed: boolean; type: string | null } {
    let type: string | null = null

    try {
        const event = JSON.parse(line) as Record<string, unknown>

        if (!event || Array.isArray(event) || typeof event.type !== 'string') {
            throw new Error('expected a JSON event object with a type')
        }

        type = event.type

        if (event.type === 'response' && event.id === BRIEF_COMMAND_ID) {
            const disposition = (event.data as Record<string, unknown> | undefined)?.disposition

            if (event.success !== true) {
                throw new Error(`Pi refused the brief: ${textOf(event.error, 'no reason given')}`)
            }

            if (!ACCEPTED_DISPOSITIONS.includes(String(disposition))) {
                throw new Error(`Pi did not run the brief: ${String(disposition)}`)
            }

            state.accepted = true
        }

        /* A correction starts another turn, which must settle again before the run can succeed. */
        if (event.type === 'agent_start') {
            state.started = true
            state.settled = false
        }

        if (event.type === 'agent_settled') {
            if (typeof event.aborted !== 'boolean') {
                throw new Error('invalid agent_settled.aborted')
            }

            state.settled = true
            state.aborted = event.aborted
        }

        if (event.type === 'auto_retry_start' || event.type === 'summarization_retry_scheduled') {
            state.retryCount++
        }

        if (event.type === 'compaction_end' && event.result) {
            state.compactionCount++
        }

        if (event.type === 'tool_execution_end' && event.isError === true) {
            state.toolErrorCount++
        }

        if (event.type === 'message_end') {
            const message = event.message as Record<string, unknown> | undefined

            if (!message || typeof message.role !== 'string') {
                throw new Error('invalid message_end.message')
            }

            if (message.role === 'assistant') {
                if (!Array.isArray(message.content) || typeof message.stopReason !== 'string') {
                    throw new Error('invalid assistant message')
                }

                state.stopReason = message.stopReason
                state.text = message.content
                    .map((block: Record<string, unknown>) => {
                        if (!block || typeof block.type !== 'string') {
                            throw new Error('invalid content block')
                        }

                        if (block.type === 'text' && typeof block.text !== 'string') {
                            throw new Error('invalid text block')
                        }

                        return block.type === 'text' ? block.text : ''
                    })
                    .join('')
                state.lastText = state.text.trim() ? state.text : state.lastText
                state.modelError =
                    typeof message.errorMessage === 'string' ? message.errorMessage : null
                /* Pi keeps one pattern list per provider's wording; ft reuses it rather than keep its own. */
                state.contextOverflow = isContextOverflow(message as unknown as AssistantMessage)
            }
        }

        const changed = track(state, event)

        observe(event)

        return { changed, type }
    } catch (error) {
        state.protocolError ??= error instanceof Error ? error.message : 'Malformed protocol'

        return { changed: false, type }
    }
}

/**
 * Build a UTF-8-safe streaming JSONL consumer; LF alone delimits records.
 * @param state - judge to update
 * @param changed - called once per chunk whose events changed the run's visible progress
 * @param observe - sees every well-formed record, in order
 * @param keep - receives each line worth recording, malformed ones included
 * @returns chunk and EOF consumers
 */
export function eventParser(
    state: JudgeState,
    changed: () => void = () => {},
    observe: (event: Record<string, unknown>) => void = () => {},
    keep: (line: string) => void = () => {},
): { push: (chunk: Buffer) => void; end: () => void } {
    const decoder = new StringDecoder('utf8')
    /* The unfinished record's pieces, joined once its LF arrives, so a long record is not rescanned per chunk. */
    let pending: string[] = []

    return {
        push(chunk) {
            const text = decoder.write(chunk)
            let start = 0
            let lf = text.indexOf('\n')
            let progressed = false

            while (lf >= 0) {
                const line = (pending.join('') + text.slice(start, lf)).replace(/\r$/, '')
                const result = record(state, line, observe)

                pending = []
                progressed = result.changed || progressed

                if (!result.type || !UNRECORDED_EVENTS.includes(result.type)) {
                    keep(line)
                }

                start = lf + 1
                lf = text.indexOf('\n', start)
            }

            if (start < text.length) {
                pending.push(text.slice(start))
            }

            if (progressed) {
                changed()
            }
        },
        end() {
            const rest = pending.join('') + decoder.end()

            if (rest) {
                keep(rest)
                state.protocolError ??= 'Unterminated JSONL record'
            }
        },
    }
}

/**
 * Judge terminal protocol and process state independently of Pi's exit conventions.
 * @param state - parsed events
 * @param code - Pi process exit code
 * @param signal - terminating signal
 * @returns Pi's verdict
 */
export function judgeOutcome(
    state: JudgeState,
    code: number | null,
    signal: string | null,
): Verdict {
    if (state.protocolError) {
        return 'protocol_error'
    }

    if (code !== 0 || signal) {
        return 'runtime_error'
    }

    if (!state.accepted || !state.started || !state.settled || state.aborted) {
        return 'incomplete'
    }

    if (state.stopReason === 'error' || state.stopReason === 'aborted') {
        return 'model_error'
    }

    if (state.stopReason !== 'stop' || !state.text.trim()) {
        return 'incomplete'
    }

    return 'success'
}
