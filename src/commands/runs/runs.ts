import { projectRoot } from '../../project/config/config'
import { renderTable } from '../../project/runs/render'
import { listRuns, stateOf } from '../../project/runs/store'
import { RECENT_RUNS } from './constants'

/**
 * List the project's runs, newest first: every running run, then recent finished ones.
 * @param options - command options
 * @param options.all - list every run
 * @param options.json - print one JSON object per run
 * @returns completion
 */
export async function runs(options: { all?: boolean; json?: boolean }): Promise<void> {
    const statuses = await listRuns(projectRoot())
    const listed = statuses.map(status => ({
        status,
        state: stateOf(status),
    }))
    const shown = options.all
        ? listed
        : listed.filter(({ state }, index) => state === 'running' || index < RECENT_RUNS)

    if (options.json) {
        process.stdout.write(
            shown.map(({ status, state }) => `${JSON.stringify({ ...status, state })}\n`).join(''),
        )

        return
    }

    if (shown.length === 0) {
        process.stdout.write('No runs yet in this project. Start one with ft run or ft start\n')

        return
    }

    const hidden = listed.length - shown.length

    process.stdout.write(
        `${renderTable(shown)}${hidden > 0 ? `(${hidden} older runs; ft runs --all lists them)\n` : ''}`,
    )
}
