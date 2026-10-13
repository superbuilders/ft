import { StringDecoder } from 'node:string_decoder'

import { emptyProgress } from '../../project/runs/store'
import { track } from './progress'

import type { Progress } from '../../project/runs/types'
import type { JudgeState, Verdict } from './types'

/**
 * Initialize a protocol judge without accepting streamed deltas as an answer.
 * @param progress - the record to keep current, such as the run's live status
 * @returns new judge state
 */
export function createJudge(progress: Progress = emptyProgress()): JudgeState {
    return {
        header: false,
        started: false,
        settled: false,
        aborted: false,
        stopReason: null,
        text: '',
        lastText: '',
        modelError: null,
        protocolError: null,
        retryCount: 0,
        compactionCount: 0,
        toolErrorCount: 0,
        progress,
        pending: new Map(),
    }
}

/**
 * Consume an authoritative JSON event.
 * @param state - mutable run judge
 * @param line - one LF-delimited record
 * @returns whether the run's visible progress changed; failures are recorded in state
 */
function record(state: JudgeState, line: string): boolean {
    try {
        const event = JSON.parse(line) as Record<string, unknown>

        if (!event || Array.isArray(event) || typeof event.type !== 'string') {
            throw new Error('expected a JSON event object with a type')
        }

        if (!state.header && event.type !== 'session') {
            throw new Error('missing initial session header')
        }

        if (event.type === 'session') {
            state.header = true
        }

        if (event.type === 'agent_start') {
            state.started = true
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

        if (event.type === 'compaction_start') {
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
            }
        }

        return track(state, event)
    } catch (error) {
        state.protocolError ??= error instanceof Error ? error.message : 'Malformed protocol'

        return false
    }
}

/**
 * Build a UTF-8-safe streaming JSONL consumer; LF alone delimits records.
 * @param state - judge to update
 * @param changed - called once per chunk whose events changed the run's visible progress
 * @returns chunk and EOF consumers
 */
export function eventParser(
    state: JudgeState,
    changed: () => void = () => {},
): { push: (chunk: Buffer) => void; end: () => void } {
    const decoder = new StringDecoder('utf8')
    let pending = ''

    return {
        push(chunk) {
            pending += decoder.write(chunk)

            let lf = pending.indexOf('\n')
            let progressed = false

            while (lf >= 0) {
                progressed = record(state, pending.slice(0, lf).replace(/\r$/, '')) || progressed
                pending = pending.slice(lf + 1)
                lf = pending.indexOf('\n')
            }

            if (progressed) {
                changed()
            }
        },
        end() {
            pending += decoder.end()

            if (pending.length > 0) {
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

    if (!state.header || !state.started || !state.settled || state.aborted) {
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
