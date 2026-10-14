import { isAbsolute, relative } from 'node:path'

import { commandName } from '../../system/process/self'
import { PLAIN } from '../../system/terminal/style'
import { EXIT_CODES, INLINE_ANSWER_MAX, NEXT_STEPS } from './constants'
import { AUTH_REJECTED } from './patterns'
import { readKept } from './store'

import type { Style } from '../../system/terminal/types'
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
        model_error: 'failed with a model provider error',
        incomplete: 'stopped without a final answer',
        protocol_error: "failed: Pi's output could not be read",
        runtime_error: 'failed while running the session',
        configuration_error: 'could not start',
        timeout: 'timed out',
        cancelled: 'was cancelled',
        lost: 'stopped without a saved outcome',
    }

    return phrases[state]
}

/**
 * Color a state the way a reader scans for it: green for success, yellow while running, red for
 * every way a run can fail.
 * @param state - stored outcome, or `lost`
 * @param style - output styles
 * @returns the style for this state
 */
function stateColor(state: State, style: Style): (text: string) => string {
    if (state === 'success') {
        return style.green
    }

    return state === 'running' ? style.yellow : style.red
}

/**
 * Count what happened to a set of runs in one line, naming each run that did not succeed.
 * @param settled - each run and its final state
 * @param style - output styles
 * @returns e.g. `8 runs: 7 succeeded; review-k3x2 failed with a model provider error`
 */
export function tally(settled: { status: Status; state: State }[], style = PLAIN): string {
    const succeeded = settled.filter(({ state }) => state === 'success').length
    const others = settled
        .filter(({ state }) => state !== 'success')
        .map(({ status, state }) => `${style.bold(status.id)} ${style.red(verdict(state))}`)
    const count = `${succeeded} succeeded`

    return `${style.mark(others.length === 0)}${[
        `${settled.length} ${settled.length === 1 ? 'run' : 'runs'}: ${succeeded > 0 ? style.green(count) : count}`,
        ...others,
    ].join('; ')}`
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
 * @param style - output styles
 * @returns e.g. `review-k3x2 succeeded in 4m12s (truefoundry/gpt-6.1-sol, 38.2k tokens)`
 */
export function headline(status: Status, state: State, style = PLAIN): string {
    const id = style.bold(status.id)
    const details = style.dim(facts(status))

    if (state === 'running') {
        return `${id} ${style.yellow('has been running')} for ${formatDuration(elapsed(status))}${details}`
    }

    const said = stateColor(state, style)(verdict(state))

    if (state === 'configuration_error') {
        return `${id} ${said}${details}`
    }

    return `${id} ${said} in ${formatDuration(elapsed(status))}${details}`
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
 * @returns the hint with the run's id and ft's command name filled in, or null on success or while running
 */
function nextStep(status: Status, state: State): string | null {
    if (state === 'success' || state === 'running') {
        return null
    }

    return NEXT_STEPS[stepKey(status, state)]
        .replaceAll('<id>', status.id)
        .replaceAll('<provider>', status.provider ?? '<provider>')
        .replaceAll('<ft>', commandName())
}

/**
 * Which hint fits a failed run: a model error is told apart by what the provider said.
 * @param status - run status
 * @param state - a failed state
 * @returns the NEXT_STEPS key
 */
function stepKey(
    status: Status,
    state: Exclude<State, 'success' | 'running'>,
): keyof typeof NEXT_STEPS {
    if (state !== 'model_error') {
        return state
    }

    if (status.contextOverflow) {
        return 'context_overflow'
    }

    return AUTH_REJECTED.test(status.error ?? '') ? 'auth_rejected' : state
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
 * The report a caller reads when a run ends: verdict, what it did, what next, and where the answer
 * is. The answer stays in its file, so a caller watching many runs reads only the answers it
 * needs; `ft show` prints it. The last line restates the verdict, because some harnesses keep only
 * the tail of long output.
 * @param status - settled run status
 * @param state - stored outcome, or `lost`
 * @param text - the answer or partial answer, if any
 * @param inShow - the report is inside `ft show`: print the answer and do not point at `ft show`
 * @param style - output styles
 * @returns report text ending in a newline
 */
export function renderReport(
    status: Status,
    state: State,
    text: string | null,
    inShow = false,
    style = PLAIN,
): string {
    const lines = [headline(status, state, style)]
    const activity = activityLine(status)
    const next = nextStep(status, state)

    if (activity) {
        lines.push(style.dim(activity))
    }

    if (status.error && state !== 'success') {
        lines.push(style.red(`Error: ${status.error}`))
    }

    if (next) {
        lines.push(`${style.bold('Next:')} ${next}`)
    }

    const saved = status.answer ?? status.partial
    const kept = text?.trim() ? text : null

    if (inShow && kept && saved) {
        lines.push('')

        if (!status.answer) {
            lines.push("The model's last message (not a final answer):", '')
        }

        lines.push(inline(kept, saved), '')
    }

    const count = kept ? kept.trimEnd().split('\n').length : 0
    const size = kept ? `, ${count} ${count === 1 ? 'line' : 'lines'}` : ''
    const notes = [
        saved
            ? style.dim(
                  `${status.answer ? 'answer' : 'partial answer'} in ${displayPath(saved)}${size}`,
              )
            : null,
        !inShow && state !== 'configuration_error'
            ? `${style.cyan(`${commandName()} show ${status.id}`)}${style.dim(' for every step and the answer')}`
            : null,
    ].filter(Boolean)
    const said = stateColor(state, style)(verdict(state))
    const aside =
        notes.length > 0 ? ` ${style.dim('(')}${notes.join(style.dim('; '))}${style.dim(')')}` : ''

    lines.push(`${style.mark(state === 'success')}${style.bold(status.id)} ${said}${aside}`)

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
 * Leave text as it is.
 * @param text - any text
 * @returns the same text
 */
function unstyled(text: string): string {
    return text
}

/**
 * One table of runs, a row each, columns padded to fit. Styling wraps each cell after padding, so
 * the columns line up the same with color as without.
 * @param runs - statuses with their states, newest first
 * @param style - output styles
 * @returns table text ending in a newline
 */
export function renderTable(runs: { status: Status; state: State }[], style = PLAIN): string {
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
    const quiet = new Set(['STARTED', 'TIME', 'TOKENS', 'COST', 'MODEL'])

    /**
     * Pad one cell to its column, then style it.
     * @param cell - cell text
     * @param column - column index
     * @param color - the cell's style
     * @returns the cell as printed
     */
    function cellText(cell: string, column: number, color: (text: string) => string): string {
        return color(column === header.length - 1 ? cell : cell.padEnd(widths[column] ?? 0))
    }

    const head = header.map((cell, column) => cellText(cell, column, style.dim)).join('  ')
    const body = rows.map((row, index) =>
        row
            .map((cell, column) => {
                const name = header[column] ?? ''
                let color = unstyled

                if (name === 'RUN') {
                    color = style.bold
                } else if (name === 'STATE') {
                    color = stateColor(runs[index]?.state ?? 'lost', style)
                } else if (quiet.has(name)) {
                    color = style.dim
                }

                return cellText(cell, column, color)
            })
            .join('  '),
    )

    return `${[head, ...body].join('\n')}\n`
}

/**
 * Render a settled run the way the caller asked for it: its JSON line, or its report.
 * @param status - settled status
 * @param state - its state
 * @param json - print the status as JSON
 * @param style - output styles for the report
 * @returns the text to print
 */
export async function settledOutput(
    status: Status,
    state: State,
    json: boolean | undefined,
    style = PLAIN,
): Promise<string> {
    return json
        ? jsonLine(status, state)
        : renderReport(status, state, await readKept(status), false, style)
}
