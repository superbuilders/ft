import { ACTIVITY_MAX, FILE_TOOLS } from './constants'

import type { Progress } from '../../project/runs/types'

/**
 * Squeeze text onto one line of bounded length.
 * @param text - any text
 * @returns a single short line
 */
export function oneLine(text: string): string {
    const line = text.replaceAll(/\s+/g, ' ').trim()

    return line.length > ACTIVITY_MAX ? `${line.slice(0, ACTIVITY_MAX - 1)}…` : line
}

/**
 * Describe a tool call the way a person would read it in a list.
 * @param tool - tool name
 * @param args - the call's arguments
 * @returns `tool: what` on one line
 */
export function describeCall(tool: string, args: Record<string, unknown>): string {
    const subject = [args.command, args.path, args.pattern, args.query].find(
        value => typeof value === 'string' && value.trim(),
    )

    return oneLine(typeof subject === 'string' ? `${tool}: ${subject}` : tool)
}

/**
 * Number a field that may be absent.
 * @param value - candidate
 * @returns the number, or 0
 */
function count(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/**
 * Read an event field that should be text.
 * @param value - the field
 * @param fallback - what to say when it is not text
 * @returns the text, or the fallback
 */
export function textOf(value: unknown, fallback: string): string {
    return typeof value === 'string' && value ? value : fallback
}

/**
 * Fold one Pi event into what a person watching the run wants to know. A file counts as written
 * only once its edit or write call succeeds.
 * @param tracker - mutable progress and the file calls still running
 * @param tracker.progress - mutable progress
 * @param tracker.pending - paths of edit and write calls still running, by tool call id
 * @param event - one parsed event
 * @returns whether anything worth publishing changed
 */
export function track(
    tracker: { progress: Progress; pending: Map<string, string> },
    event: Record<string, unknown>,
): boolean {
    const { progress, pending } = tracker

    if (event.type === 'turn_start') {
        progress.turns++
        progress.activity = 'thinking'

        return true
    }

    if (event.type === 'tool_execution_start' && typeof event.toolName === 'string') {
        const args = (event.args ?? {}) as Record<string, unknown>

        progress.tools[event.toolName] = (progress.tools[event.toolName] ?? 0) + 1
        progress.activity = describeCall(event.toolName, args)

        if (
            FILE_TOOLS.includes(event.toolName) &&
            typeof args.path === 'string' &&
            typeof event.toolCallId === 'string'
        ) {
            pending.set(event.toolCallId, args.path)
        }

        return true
    }

    if (event.type === 'tool_execution_end' && typeof event.toolCallId === 'string') {
        const path = pending.get(event.toolCallId)

        pending.delete(event.toolCallId)

        if (path && event.isError !== true && !progress.files.includes(path)) {
            progress.files.push(path)

            return true
        }

        return false
    }

    if (event.type === 'auto_retry_start') {
        progress.activity = oneLine(
            `retry ${count(event.attempt)} of ${count(event.maxAttempts)} after ${textOf(event.errorMessage, 'an error')}`,
        )

        return true
    }

    if (event.type === 'compaction_start') {
        progress.activity = 'compacting the conversation to fit the context window'

        return true
    }

    if (event.type === 'message_end') {
        const message = event.message as Record<string, unknown> | undefined
        const usage = message?.usage as Record<string, unknown> | undefined

        if (message?.role !== 'assistant' || !usage) {
            return false
        }

        progress.usage.input += count(usage.input)
        progress.usage.output += count(usage.output)
        progress.usage.cacheRead += count(usage.cacheRead)
        progress.usage.cacheWrite += count(usage.cacheWrite)
        progress.usage.cost += count((usage.cost as Record<string, unknown> | undefined)?.total)

        return true
    }

    return false
}
