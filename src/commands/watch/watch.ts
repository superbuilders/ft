import { projectRoot } from '../../project/config/config'
import { exitCode, jsonLine, renderTable, settledOutput, tally } from '../../project/runs/render'
import { findRuns, listRuns, readStatus, stateOf } from '../../project/runs/store'
import { styleFor } from '../../system/terminal/style'
import { WAIT_POLL_MS } from './constants'

import type { State, Status } from '../../project/runs/types'

/**
 * Tell a person at the terminal what each run is doing now, once per change. Agents read only
 * stdout, so this goes to stderr and only when stderr is a terminal.
 * @param running - runs still running
 * @param seen - the last line printed for each run, by id
 */
function narrate(running: Status[], seen: Map<string, string>): void {
    const style = styleFor(process.stderr)

    for (const status of running) {
        const activity = status.activity ?? 'starting'

        if (seen.get(status.id) !== activity) {
            seen.set(status.id, activity)
            process.stderr.write(`${style.dim(`${status.id}:`)} ${activity}\n`)
        }
    }
}

/**
 * Validate the caller's timeout.
 * @param timeout - seconds as typed
 * @returns milliseconds, or Infinity when none was given
 */
function timeoutMs(timeout: string | undefined): number {
    if (timeout === undefined) {
        return Number.POSITIVE_INFINITY
    }

    const seconds = Number(timeout)

    if (!Number.isFinite(seconds) || seconds < 0) {
        throw new Error('--timeout must be zero or more seconds')
    }

    return seconds * 1000
}

/**
 * Watch runs until they settle, printing each one's report as it does, and telling a person at
 * the terminal what each run is doing meanwhile. With no ids, watch every
 * run in this project that is running now; a run that finished earlier needs its id. When the timeout ends first, list what is still
 * running and exit 75, so a caller whose shell tool has a time limit can simply call again.
 * @param ids - run ids or unambiguous prefixes
 * @param options - command options
 * @param options.timeout - seconds to watch at most
 * @param options.json - print one JSON object per run instead of reports
 * @returns 0 when every run succeeded, else the highest failure exit code, or 75 when time ran out
 */
export async function watch(
    ids: string[],
    options: { timeout?: string; json?: boolean },
): Promise<number> {
    const root = projectRoot()
    const limit = Date.now() + timeoutMs(options.timeout)
    const named = ids.length > 0
    const found = named ? await findRuns(root, ids) : await listRuns(root)
    const targets = named ? found : found.filter(status => stateOf(status) === 'running')

    if (targets.length === 0) {
        if (!options.json) {
            process.stdout.write(
                'No runs are running in this project. To watch a finished run, pass its id (ft list shows ids).\n',
            )
        }

        return 0
    }

    let pending = targets.map(status => status.dir)
    const settled: { status: Status; state: State }[] = []
    const seen = new Map<string, string>()
    const narrating = !options.json && process.stderr.isTTY
    const style = styleFor(process.stdout)

    for (;;) {
        const read = await Promise.all(pending.map(readStatus))
        const running: Status[] = []

        for (const status of read) {
            const state = status ? stateOf(status) : 'lost'

            if (status && state !== 'running') {
                process.stdout.write(
                    `${await settledOutput(status, state, options.json, style)}${options.json ? '' : '\n'}`,
                )
                settled.push({ status, state })
            } else if (status) {
                running.push(status)
            }
        }

        pending = running.map(status => status.dir)

        if (narrating) {
            narrate(running, seen)
        }

        if (pending.length === 0) {
            if (!options.json) {
                process.stdout.write(`${tally(settled, style)}\n`)
            }

            return Math.max(0, ...settled.map(({ state }) => exitCode(state)))
        }

        if (Date.now() >= limit) {
            if (options.json) {
                process.stdout.write(running.map(status => jsonLine(status, 'running')).join(''))
            } else {
                const table = renderTable(
                    running.map(status => ({ status, state: 'running' as const })),
                    style,
                )
                const waiting = running.map(status => status.id).join(' ')
                const finished = settled.length > 0 ? `${tally(settled, style)}\n` : ''

                process.stdout.write(
                    `${finished}${table}Still running. Run ${style.cyan(`ft watch ${waiting}`)} again to keep watching.\n`,
                )
            }

            return exitCode('running')
        }

        await Bun.sleep(Math.min(WAIT_POLL_MS, Math.max(0, limit - Date.now())))
    }
}
