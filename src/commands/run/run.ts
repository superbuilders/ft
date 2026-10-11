import { displayPath, exitCode, jsonLine, renderReport } from '../../project/runs/render'
import { readKept, readStatus, writeStatus } from '../../project/runs/store'
import { selfCommand } from '../../system/process/self'
import { START_CONFIRM_MS, START_POLL_MS } from './constants'
import { execute } from './execute'
import { prepare } from './prepare'

import type { Status } from '../../project/runs/types'
import type { RunOptions } from './types'

/**
 * Report a mistake caught before any run existed.
 * @param error - what went wrong
 * @param json - print JSON instead of text
 * @returns the configuration-error exit code
 */
function refuse(error: unknown, json: boolean | undefined): number {
    const message = error instanceof Error ? error.message : 'ft could not start the run'

    if (json) {
        process.stdout.write(
            `${JSON.stringify({ outcome: 'configuration_error', error: message })}\n`,
        )
    } else {
        process.stderr.write(`ft could not start the run (configuration_error): ${message}\n`)
    }

    return exitCode('configuration_error')
}

/**
 * Print a settled run the way the caller asked for it.
 * @param status - settled status
 * @param json - print the status as JSON
 * @returns completion
 */
async function printSettled(status: Status, json: boolean | undefined): Promise<void> {
    process.stdout.write(
        json
            ? jsonLine(status, status.outcome)
            : renderReport(status, status.outcome, await readKept(status)),
    )
}

/**
 * Run one brief in the foreground and print its report.
 * @param options - caller options
 * @returns the run's exit code
 */
export async function run(options: RunOptions): Promise<number> {
    let status: Status

    try {
        status = await prepare(options)
    } catch (error) {
        return refuse(error, options.json)
    }

    const settled = await execute(status.dir)

    await printSettled(settled, options.json)

    return exitCode(settled.outcome)
}

/**
 * Start one brief detached from this shell and return at once; `ft wait` collects it. The run
 * keeps going when the harness kills or backgrounds the command that started it.
 * @param options - caller options
 * @returns 0 once the run is started, or the configuration-error code
 */
export async function start(options: RunOptions): Promise<number> {
    let status: Status

    try {
        status = await prepare(options)
    } catch (error) {
        return refuse(error, options.json)
    }

    const child = Bun.spawn([...selfCommand(), 'exec', status.dir], {
        cwd: process.cwd(),
        env: process.env,
        detached: true,
        stdio: ['ignore', 'ignore', 'ignore'],
    })

    let exited: number | null = null

    child.unref()
    void child.exited.then(code => {
        exited = code
    })

    const giveUp = Date.now() + START_CONFIRM_MS

    for (;;) {
        const current = (await readStatus(status.dir)) ?? status

        if (current.pid !== null || current.outcome !== 'running') {
            status = current
            break
        }

        /*
         * The child died before it could own the run, so nothing else would ever settle it. Read
         * once more first: it may have settled the run between the read above and its exit.
         */
        if (exited !== null) {
            const last = (await readStatus(status.dir)) ?? current

            if (last.pid !== null || last.outcome !== 'running') {
                status = last
                break
            }

            status = {
                ...last,
                outcome: 'runtime_error',
                error: `The run's process exited (code ${String(exited)}) before it started`,
            }
            await writeStatus(status)
            break
        }

        if (Date.now() > giveUp) {
            process.stderr.write(
                `ft started ${status.id} but it has not reported in; ft wait ${status.id} will tell\n`,
            )
            break
        }

        await Bun.sleep(START_POLL_MS)
    }

    if (status.outcome !== 'running') {
        await printSettled(status, options.json)

        return exitCode(status.outcome)
    }

    if (options.json) {
        process.stdout.write(jsonLine(status, status.outcome))
    } else {
        process.stdout.write(
            `Started ${status.id} (${status.provider}/${status.model}, ${status.profile} profile): ${status.title}\n` +
                `Its record is in ${displayPath(status.dir)}. Collect it with: ft wait ${status.id}\n`,
        )
    }

    return 0
}

/**
 * Execute a run that `ft start` prepared; this is the detached process, so it prints nothing.
 * @param dir - the run's folder
 * @returns the run's exit code
 */
export async function exec(dir: string): Promise<number> {
    const settled = await execute(dir)

    return exitCode(settled.outcome)
}
