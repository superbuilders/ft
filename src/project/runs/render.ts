import { isAbsolute, relative } from 'node:path'

import { EXIT_CODES, INLINE_ANSWER_MAX, NEXT_STEPS } from './constants'
import { CONTEXT_OVERFLOW } from './patterns'
import { readKept } from './store'

import type { State, Status } from './types'

/**
 * One run as a JSON line: its status plus the state a reader derives from it.
 * @param status - run status
 * @param state - stored outcome, or `lost`
 * @returns one line of JSON ending in a newline
 */
export function jsonLine(status: Status, state: State): string {
    return `${JSON.stringify({ ...status, state })}\n`
}

/**
 * Map a run's state to the process exit code callers branch on.
 * @param state - stored outcome, or `lost`
 * @returns exit code
 */
export function exitCode(state: State): number {
    return EXIT_CODES[state]
}

/**
 * Show a path the way the caller can type it: relative when it is under the working directory.
 * @param path - absolute path
 * @returns short path
 */
export function displayPath(path: string): string {
    const near = relative(process.cwd(), path)

    return near && !near.startsWith('..') && !isAbsolute(near) ? near : path
}

/**
 * Write a duration the way people say it.
 * @param ms - milliseconds
 * @returns e.g. `0.8s`, `42s`, `4m12s`, `1h03m`
 */
export function formatDuration(ms: number): string {
    const seconds = Math.round(ms / 1000)

    if (ms < 10_000) {
        return `${(ms / 1000).toFixed(1)}s`
    }

    if (seconds < 60) {
        return `${seconds}s`
    }

    if (seconds < 3600) {
        return `${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, '0')}s`
    }

    return `${Math.floor(seconds / 3600)}h${String(Math.floor((seconds % 3600) / 60)).padStart(2, '0')}m`
}

/**
 * Write a token count compactly.
 * @param tokens - count
 * @returns e.g. `950`, `38.2k`, `1.2M`
 */
export function formatTokens(tokens: number): string {
    if (tokens < 1000) {
        return String(tokens)
    }

    return tokens < 1_000_000 ? `${(tokens / 1000).toFixed(1)}k` : `${(tokens / 1e6).toFixed(1)}M`
}

/**
 * Total tokens the run moved through the model.
 * @param status - run status
 * @returns input, output and cache tokens together
 */
function totalTokens(status: Status): number {
    const { input, output, cacheRead, cacheWrite } = status.usage

    return input + output + cacheRead + cacheWrite
}

/**
 * Milliseconds the run has taken: its final duration, or time since it started.
 * @param status - run status
 * @returns elapsed milliseconds
 */
function elapsed(status: Status): number {
    return status.outcome === 'running'
        ? Date.now() - Date.parse(status.startedAt)
        : status.durationMs
}

/**
 * Say what happened to the run in a few words.
 * @param state - stored outcome, or `lost`
 * @returns a verb phrase
 */
function verdict(state: State): string {
    const phrases: Record<State, string> = {
        running: 'is running',
        success: 'succeeded',
        model_error: 'failed (model_error)',
        incomplete: 'stopped without a final answer (incomplete)',
        protocol_error: 'failed (protocol_error)',
        runtime_error: 'failed (runtime_error)',
        configuration_error: 'could not start (configuration_error)',
        timeout: 'timed out',
        cancelled: 'was cancelled',
        lost: 'was lost',
    }

    return phrases[state]
}

/**
 * The run's facts in one parenthesis: model, thinking, tokens, cost.
 * @param status - run status
 * @returns the parenthetical, or empty before the model is known
 */
function facts(status: Status): string {
    const parts = [
        status.provider && status.model ? `${status.provider}/${status.model}` : null,
        status.thinking ? `thinking ${status.thinking}` : null,
        totalTokens(status) > 0 ? `${formatTokens(totalTokens(status))} tokens` : null,
        status.usage.cost > 0 ? `$${status.usage.cost.toFixed(2)}` : null,
    ].filter(Boolean)

    return parts.length > 0 ? ` (${parts.join(', ')})` : ''
}

/**
 * The report's first line.
 * @param status - run status
 * @param state - stored outcome, or `lost`
 * @returns e.g. `review-k3x2 succeeded in 4m12s (truefoundry/gpt-6.1-sol, 38.2k tokens)`
 */
export function headline(status: Status, state: State): string {
    if (state === 'running') {
        return `${status.id} has been running for ${formatDuration(elapsed(status))}${facts(status)}`
    }

    if (state === 'configuration_error') {
        return `${status.id} ${verdict(state)}${facts(status)}`
    }

    return `${status.id} ${verdict(state)} in ${formatDuration(elapsed(status))}${facts(status)}`
}

/**
 * List what the run used and changed.
 * @param status - run status
 * @returns a sentence, or null when the run called no tools
 */
function activityLine(status: Status): string | null {
    const tools = Object.entries(status.tools)
        .toSorted(([, a], [, b]) => b - a)
        .map(([name, calls]) => `${name} ${calls}`)

    if (tools.length === 0) {
        return null
    }

    const wrote =
        status.files.length > 0
            ? ` Wrote ${status.files.join(', ')}${status.profile === 'write' ? ' (edits made through bash are not listed)' : ''}.`
            : ''

    return `Tools: ${tools.join(', ')}.${wrote}`
}

/**
 * Say what to do about a failed run.
 * @param status - run status
 * @param state - stored outcome, or `lost`
 * @returns the hint with the run's id filled in, or null on success or while running
 */
function nextStep(status: Status, state: State): string | null {
    if (state === 'success' || state === 'running') {
        return null
    }

    const key =
        state === 'model_error' && CONTEXT_OVERFLOW.test(status.error ?? '')
            ? 'context_overflow'
            : state

    return NEXT_STEPS[key].replaceAll('<id>', status.id)
}

/**
 * Cut long text to what a harness shows inline, pointing at the file for the rest.
 * @param text - full text
 * @param path - where the full text lives
 * @returns text that fits
 */
function inline(text: string, path: string): string {
    if (text.length <= INLINE_ANSWER_MAX) {
        return text.trimEnd()
    }

    return `${text.slice(0, INLINE_ANSWER_MAX).trimEnd()}\n\n(${text.length - INLINE_ANSWER_MAX} more characters in ${displayPath(path)})`
}

/**
 * The report a caller reads when a run ends: verdict, what it did, the answer, what next. The last
 * line restates the verdict, because some harnesses keep only the tail of long output.
 * @param status - settled run status
 * @param state - stored outcome, or `lost`
 * @param text - the answer or partial answer, if any
 * @param pointToShow - end by pointing at `ft show`; false when the report is already inside it
 * @returns report text ending in a newline
 */
export function renderReport(
    status: Status,
    state: State,
    text: string | null,
    pointToShow = true,
): string {
    const lines = [headline(status, state)]
    const activity = activityLine(status)
    const next = nextStep(status, state)

    if (activity) {
        lines.push(activity)
    }

    if (status.error && state !== 'success') {
        lines.push(`Error: ${status.error}`)
    }

    if (next) {
        lines.push(`Next: ${next}`)
    }

    const saved = status.answer ?? status.partial

    if (text?.trim() && saved) {
        lines.push('')

        if (!status.answer) {
            lines.push("The model's last message before the run stopped:", '')
        }

        lines.push(inline(text, saved), '')
    }

    const notes = [
        saved ? `${status.answer ? 'answer' : 'partial answer'} in ${displayPath(saved)}` : null,
        pointToShow && state !== 'configuration_error'
            ? `ft show ${status.id} for every step`
            : null,
    ].filter(Boolean)

    lines.push(`${status.id} ${verdict(state)}${notes.length > 0 ? ` (${notes.join('; ')})` : ''}`)

    return `${lines.join('\n')}\n`
}

/**
 * Describe how long ago something happened.
 * @param iso - ISO 8601 time
 * @returns e.g. `12s ago`, `4m ago`, `3h ago`, `2d ago`
 */
export function ago(iso: string): string {
    const seconds = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000))

    if (seconds < 60) {
        return `${seconds}s ago`
    }

    if (seconds < 3600) {
        return `${Math.floor(seconds / 60)}m ago`
    }

    return seconds < 86_400
        ? `${Math.floor(seconds / 3600)}h ago`
        : `${Math.floor(seconds / 86_400)}d ago`
}

/**
 * What a table row says the run is about: its current step while running, its error after a
 * failure, its brief's title otherwise.
 * @param status - run status
 * @param state - stored outcome, or `lost`
 * @returns one line
 */
function rowSubject(status: Status, state: State): string {
    if (state === 'running') {
        return `now: ${status.activity ?? 'starting'}`
    }

    if (state === 'success' || !status.error) {
        return status.title
    }

    return status.error.split('\n')[0] ?? status.title
}

/**
 * One table of runs, a row each, columns padded to fit.
 * @param runs - statuses with their states, newest first
 * @returns table text ending in a newline
 */
export function renderTable(runs: { status: Status; state: State }[]): string {
    const priced = runs.some(({ status }) => status.usage.cost > 0)
    const header = [
        'RUN',
        'STATE',
        'STARTED',
        'TIME',
        'TOKENS',
        ...(priced ? ['COST'] : []),
        'MODEL',
        'WHAT',
    ]
    const rows = runs.map(({ status, state }) => [
        status.id,
        state,
        ago(status.startedAt),
        formatDuration(elapsed(status)),
        formatTokens(totalTokens(status)),
        ...(priced ? [status.usage.cost > 0 ? `$${status.usage.cost.toFixed(2)}` : ''] : []),
        status.model ?? '',
        rowSubject(status, state),
    ])
    const widths = header.map((_, column) =>
        Math.max(...[header, ...rows].map(row => (row[column] ?? '').length)),
    )

    return `${[header, ...rows]
        .map(row =>
            row
                .map((cell, column) =>
                    column === row.length - 1 ? cell : cell.padEnd(widths[column] ?? 0),
                )
                .join('  '),
        )
        .join('\n')}\n`
}

/**
 * Render a settled run the way the caller asked for it: its JSON line, or its report with the
 * kept answer inlined.
 * @param status - settled status
 * @param state - its state
 * @param json - print the status as JSON
 * @returns the text to print
 */
export async function settledOutput(
    status: Status,
    state: State,
    json: boolean | undefined,
): Promise<string> {
    return json ? jsonLine(status, state) : renderReport(status, state, await readKept(status))
}
