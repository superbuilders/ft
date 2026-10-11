import { projectRoot } from '../../project/config/config'
import { exitCode, jsonLine, renderReport, renderTable } from '../../project/runs/render'
import { findRuns, listRuns, readKept, readStatus, stateOf } from '../../project/runs/store'
import { WAIT_POLL_MS } from './constants'

import type { State, Status } from '../../project/runs/types'

/**
 * Print one run that has settled.
 * @param status - its status
 * @param state - its state
 * @param json - print JSON instead of the report
 * @returns completion
 */
async function printRun(status: Status, state: State, json: boolean | undefined): Promise<void> {
    process.stdout.write(
        json ? jsonLine(status, state) : `${renderReport(status, state, await readKept(status))}\n`,
    )
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
 * Wait for runs to settle, printing each one's report as it does. With no ids, wait for every
 * run in this project that is running now; a run that finished earlier needs its id. When the timeout ends first, list what is still
 * running and exit 75, so a caller whose shell tool has a time limit can simply call again.
 * @param ids - run ids or unambiguous prefixes
 * @param options - command options
 * @param options.timeout - seconds to wait at most
 * @param options.json - print one JSON object per run instead of reports
 * @returns 0 when every run succeeded, else the highest failure exit code, or 75 when time ran out
 */
export async function wait(
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
                'No runs are running in this project. A run that already finished needs its id: ft runs lists them\n',
            )
        }

        return 0
    }

    let pending = targets.map(status => status.dir)
    let code = 0

    for (;;) {
        const read = await Promise.all(pending.map(readStatus))
        const running: Status[] = []

        for (const status of read) {
            const state = status ? stateOf(status) : 'lost'

            if (status && state !== 'running') {
                await printRun(status, state, options.json)
                code = Math.max(code, exitCode(state))
            } else if (status) {
                running.push(status)
            }
        }

        pending = running.map(status => status.dir)

        if (pending.length === 0) {
            return code
        }

        if (Date.now() >= limit) {
            if (options.json) {
                process.stdout.write(running.map(status => jsonLine(status, 'running')).join(''))
            } else {
                const table = renderTable(
                    running.map(status => ({ status, state: 'running' as const })),
                )
                const waiting = running.map(status => status.id).join(' ')

                process.stdout.write(
                    `${table}Still running. Call ft wait ${waiting} again to keep waiting\n`,
                )
            }

            return exitCode('running')
        }

        await Bun.sleep(Math.min(WAIT_POLL_MS, Math.max(0, limit - Date.now())))
    }
}
