import { StringDecoder } from 'node:string_decoder'

import type { JudgeState, Outcome } from './types'

/**
 * Initialize a protocol judge without accepting streamed deltas as an answer.
 * @returns new judge state
 */
export function createJudge(): JudgeState {
    return {
        header: false,
        started: false,
        settled: false,
        aborted: false,
        stopReason: null,
        text: '',
        modelError: null,
        protocolError: null,
        retryCount: 0,
        compactionCount: 0,
        toolErrorCount: 0,
    }
}

/**
 * Consume an authoritative JSON event.
 * @param state - mutable run judge
 * @param line - one LF-delimited record
 * @returns nothing; failures are recorded in state
 */
function record(state: JudgeState, line: string): void {
    try {
        const event = JSON.parse(line) as Record<string, unknown>

        if (!event || Array.isArray(event) || typeof event.type !== 'string') {
            throw new Error('Expected a JSON event object with type')
        }

        if (!state.header && event.type !== 'session') {
            throw new Error('Missing initial session header')
        }

        if (event.type === 'session') {
            state.header = true
        }

        if (event.type === 'agent_start') {
            state.started = true
        }

        if (event.type === 'agent_settled') {
            if (typeof event.aborted !== 'boolean') {
                throw new Error('Invalid agent_settled.aborted')
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
                throw new Error('Invalid message_end.message')
            }

            if (message.role === 'assistant') {
                if (!Array.isArray(message.content) || typeof message.stopReason !== 'string') {
                    throw new Error('Invalid assistant message')
                }

                state.stopReason = message.stopReason
                state.text = message.content
                    .map((block: Record<string, unknown>) => {
                        if (!block || typeof block.type !== 'string') {
                            throw new Error('Invalid content block')
                        }

                        if (block.type === 'text' && typeof block.text !== 'string') {
                            throw new Error('Invalid text block')
                        }

                        return block.type === 'text' ? block.text : ''
                    })
                    .join('')
                state.modelError =
                    typeof message.errorMessage === 'string' ? message.errorMessage : null
            }
        }
    } catch (error) {
        state.protocolError ??= error instanceof Error ? error.message : 'Malformed protocol'
    }
}

/**
 * Build a UTF-8-safe streaming JSONL consumer; LF alone delimits records.
 * @param state - judge to update
 * @returns chunk and EOF consumers
 */
export function eventParser(state: JudgeState): { push: (chunk: Buffer) => void; end: () => void } {
    const decoder = new StringDecoder('utf8')
    let pending = ''

    return {
        push(chunk) {
            pending += decoder.write(chunk)

            let lf = pending.indexOf('\n')

            while (lf >= 0) {
                record(state, pending.slice(0, lf).replace(/\r$/, ''))
                pending = pending.slice(lf + 1)
                lf = pending.indexOf('\n')
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
 * @returns terminal outcome
 */
export function judgeOutcome(
    state: JudgeState,
    code: number | null,
    signal: string | null,
): Outcome {
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

/**
 * Map normalized outcomes to the public exit-code contract.
 * @param outcome - terminal outcome
 * @returns runner exit code
 */
export function exitCode(outcome: Outcome): number {
    return {
        success: 0,
        configuration_error: 2,
        model_error: 1,
        runtime_error: 1,
        incomplete: 3,
        protocol_error: 3,
        timeout: 124,
        cancelled: 130,
    }[outcome]
}
