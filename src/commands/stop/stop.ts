import { hostname } from 'node:os'

import { projectRoot } from '../../project/config/config'
import { findRuns, stateOf } from '../../project/runs/store'
import { commandName } from '../../system/process/self'
import { styleFor } from '../../system/terminal/style'

/**
 * Cancel running runs the way Ctrl-C would, so each records `cancelled` and stops its Pi.
 * @param ids - run ids or unambiguous prefixes
 * @returns 0 when every named run is stopped or already finished, 1 otherwise
 */
export async function stop(ids: string[]): Promise<number> {
    const style = styleFor(process.stdout)
    let code = 0

    for (const status of await findRuns(projectRoot(), ids)) {
        const state = stateOf(status)

        if (state !== 'running') {
            process.stdout.write(
                `${style.bold(status.id)} is not running ${style.dim(`(${state})`)}\n`,
            )
        } else if (status.pid === null || status.host !== hostname()) {
            process.stdout.write(
                `${style.mark(false)}${style.bold(status.id)} runs on ${status.host}; stop it there\n`,
            )
            code = 1
        } else {
            process.kill(status.pid, 'SIGTERM')
            process.stdout.write(
                `${style.mark(true)}Stopping ${style.bold(status.id)}; run ${style.cyan(`${commandName()} watch ${status.id}`)} to wait for its report\n`,
            )
        }
    }

    return code
}
