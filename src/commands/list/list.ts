import { projectRoot } from '../../project/config/config'
import { jsonLine, renderTable } from '../../project/runs/render'
import { listRuns, stateOf } from '../../project/runs/store'
import { styleFor } from '../../system/terminal/style'
import { RECENT_RUNS } from './constants'

/**
 * List the project's runs, newest first: every running run, then recent finished ones.
 * @param options - command options
 * @param options.all - list every run
 * @param options.json - print one JSON object per run
 * @returns completion
 */
export async function list(options: { all?: boolean; json?: boolean }): Promise<void> {
    const statuses = await listRuns(projectRoot())
    const listed = statuses.map(status => ({
        status,
        state: stateOf(status),
    }))
    const shown = options.all
        ? listed
        : listed.filter(({ state }, index) => state === 'running' || index < RECENT_RUNS)

    if (options.json) {
        process.stdout.write(shown.map(({ status, state }) => jsonLine(status, state)).join(''))

        return
    }

    if (shown.length === 0) {
        process.stdout.write(
            'No runs yet in this project. Start one with ft run <brief> or ft start <briefs>.\n',
        )

        return
    }

    const hidden = listed.length - shown.length
    const style = styleFor(process.stdout)
    const older =
        hidden > 0 ? `${style.dim(`(${hidden} older runs; ft list --all lists them)`)}\n` : ''

    process.stdout.write(`${renderTable(shown, style)}${older}`)
}
