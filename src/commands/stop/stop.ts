import { hostname } from 'node:os'

import { projectRoot } from '../../project/config/config'
import { findRuns, stateOf } from '../../project/runs/store'

/**
 * Cancel running runs the way Ctrl-C would, so each records `cancelled` and stops its Pi.
 * @param ids - run ids or unambiguous prefixes
 * @returns 0 when every named run is stopped or already finished, 1 otherwise
 */
export async function stop(ids: string[]): Promise<number> {
    let code = 0

    for (const status of await findRuns(projectRoot(), ids)) {
        const state = stateOf(status)

        if (state !== 'running') {
            process.stdout.write(`${status.id} is not running (${state})\n`)
        } else if (status.pid === null || status.host !== hostname()) {
            process.stdout.write(`${status.id} runs on ${status.host}; stop it there\n`)
            code = 1
        } else {
            process.kill(status.pid, 'SIGTERM')
            process.stdout.write(
                `Stopping ${status.id}; ft watch ${status.id} reports when it has\n`,
            )
        }
    }

    return code
}
