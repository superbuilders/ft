import { describeCall, oneLine, textOf } from './progress'

/**
 * One line of a run's story.
 */
export interface Step {
    /** Milliseconds from the session's start, when Pi's events tell; null otherwise. */
    at: number | null
    /** What happened, on one line. */
    text: string
    /** Duration or failure, shown at the end of the line. */
    note?: string
}

/**
 * Parse one event line, skipping anything that is not an event object.
 * @param line - one JSONL record
 * @returns the event, or null
 */
function parse(line: string): Record<string, unknown> | null {
    try {
        const value = JSON.parse(line) as unknown

        return value && typeof value === 'object' && !Array.isArray(value)
            ? (value as Record<string, unknown>)
            : null
    } catch {
        return null
    }
}

/**
 * The text of an assistant message, and whether it asked for tools.
 * @param message - a message_end message
 * @returns its text and whether it called tools
 */
function assistantTurn(message: Record<string, unknown>): { text: string; calls: boolean } {
    const blocks = Array.isArray(message.content)
        ? (message.content as Record<string, unknown>[])
        : []

    return {
        text: blocks
            .filter(block => block.type === 'text' && typeof block.text === 'string')
            .map(block => block.text as string)
            .join(''),
        calls: blocks.some(block => block.type === 'toolCall'),
    }
}

/**
 * Turn Pi's event stream into the steps a person reads: what the model said between tool calls,
 * each call with its duration or failure, retries and compactions, and how it ended. Tool events
 * carry no clock, so a call takes the time of the model message that asked for it.
 * @param events - the run's events.jsonl
 * @returns steps in order
 */
export function storyOf(events: string): Step[] {
    const steps: Step[] = []
    const calls = new Map<string, Step>()
    let start: number | null = null
    let now: number | null = null

    for (const line of events.split('\n')) {
        const event = parse(line)

        if (!event) {
            continue
        }

        if (event.type === 'session' && typeof event.timestamp === 'string') {
            start = Date.parse(event.timestamp)
            now = start
        }

        const at = start !== null && now !== null ? Math.max(0, now - start) : null

        if (event.type === 'message_end') {
            const message = (event.message ?? {}) as Record<string, unknown>

            if (typeof message.timestamp === 'number') {
                now = message.timestamp
            }

            if (message.role === 'assistant') {
                const turn = assistantTurn(message)
                const stamp = start !== null && now !== null ? Math.max(0, now - start) : null

                if (typeof message.errorMessage === 'string') {
                    steps.push({ at: stamp, text: oneLine(`model error: ${message.errorMessage}`) })
                } else if (turn.calls && turn.text.trim()) {
                    steps.push({ at: stamp, text: oneLine(`said: ${turn.text}`) })
                } else if (!turn.calls && turn.text.trim()) {
                    steps.push({
                        at: stamp,
                        text: `answered (${turn.text.trim().split(/\s+/).length} words)`,
                    })
                }
            }
        }

        if (event.type === 'tool_execution_start' && typeof event.toolName === 'string') {
            const step: Step = {
                at,
                text: describeCall(event.toolName, (event.args ?? {}) as Record<string, unknown>),
            }

            steps.push(step)

            if (typeof event.toolCallId === 'string') {
                calls.set(event.toolCallId, step)
            }
        }

        if (event.type === 'tool_execution_end' && typeof event.toolCallId === 'string') {
            const step = calls.get(event.toolCallId)

            if (step && event.isError === true) {
                step.note = 'failed'
            } else if (step && typeof event.durationMs === 'number') {
                step.note = `${(event.durationMs / 1000).toFixed(1)}s`
            }
        }

        if (event.type === 'auto_retry_start') {
            steps.push({
                at,
                text: oneLine(
                    `retry ${String(event.attempt)} of ${String(event.maxAttempts)} after ${textOf(event.errorMessage, 'an error')}`,
                ),
            })
        }

        if (event.type === 'auto_retry_end' && event.success === false) {
            steps.push({
                at,
                text: oneLine(`gave up retrying: ${textOf(event.finalError, 'no reason given')}`),
            })
        }

        if (event.type === 'compaction_start') {
            steps.push({ at, text: 'compacted the conversation to fit the context window' })
        }
    }

    return steps
}
