import { THINKING_LEVELS } from '../../models/constants'
import { execute } from '../../pi/run/execute'
import { exitCode, jsonLine, settledOutput } from '../../project/runs/render'
import { readStatus, writeStatus } from '../../project/runs/store'
import { commandName, selfCommand } from '../../system/process/self'
import { styleFor } from '../../system/terminal/style'
import { START_CONFIRM_MS, START_POLL_MS } from './constants'
import { prepare } from './prepare'

import type { Status } from '../../project/runs/types'
import type { RunOptions } from './types'

/**
 * Describe --thinking with every level Pi accepts, so the help cannot drift from the check.
 * @returns the option's help text
 */
export function thinkingHelp(): string {
    return `thinking level: ${THINKING_LEVELS.join(', ')}`
}

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
        process.stderr.write(
            `${styleFor(process.stderr).red(`ft: could not start the run: ${message}`)}\n`,
        )
    }

    return exitCode('configuration_error')
}

/**
 * Run one brief in the foreground and print its report.
 * @param brief - brief path, or `-` for stdin
 * @param options - caller options
 * @returns the run's exit code
 */
export async function run(brief: string, options: RunOptions): Promise<number> {
    let status: Status

    try {
        ;[status] = (await prepare([brief], options)) as [Status]
    } catch (error) {
        return refuse(error, options.json)
    }

    const settled = await execute(status.dir)

    process.stdout.write(
        await settledOutput(settled, settled.outcome, options.json, styleFor(process.stdout)),
    )

    return exitCode(settled.outcome)
}

/**
 * Spawn one prepared run detached from this shell, and wait until it owns the run or dies.
 * @param prepared - the run's first status
 * @returns its status once started, or settled when it could not start
 */
async function launch(prepared: Status): Promise<Status> {
    let child: Bun.Subprocess

    try {
        child = Bun.spawn([...selfCommand(), 'exec', prepared.dir], {
            cwd: process.cwd(),
            env: process.env,
            detached: true,
            stdio: ['ignore', 'ignore', 'ignore'],
        })
    } catch (error) {
        const failed: Status = {
            ...prepared,
            outcome: 'runtime_error',
            error: `ft could not start the run's process: ${error instanceof Error ? error.message : String(error)}`,
        }

        await writeStatus(failed)

        return failed
    }

    let exited: number | null = null

    child.unref()
    void child.exited.then(code => {
        exited = code
    })

    const giveUp = Date.now() + START_CONFIRM_MS

    for (;;) {
        const current = (await readStatus(prepared.dir)) ?? prepared

        if (current.pid !== null || current.outcome !== 'running') {
            return current
        }

        /*
         * The child died before it could own the run, so nothing else would ever settle it. Read
         * once more first: it may have settled the run between the read above and its exit.
         */
        if (exited !== null) {
            const last = (await readStatus(prepared.dir)) ?? current

            if (last.pid !== null || last.outcome !== 'running') {
                return last
            }

            const failed: Status = {
                ...last,
                outcome: 'runtime_error',
                error: `The run's process exited (code ${String(exited)}) before it started`,
            }

            await writeStatus(failed)

            return failed
        }

        if (Date.now() > giveUp) {
            process.stderr.write(
                `ft: started ${current.id}, but the run has not confirmed it is running; run ${commandName()} watch ${current.id} to wait for its report\n`,
            )

            return current
        }

        await Bun.sleep(START_POLL_MS)
    }
}

/**
 * Start briefs detached from this shell and return at once; `ft watch` collects them. Every brief
 * is checked before any run starts. The runs keep going when the harness kills or backgrounds the
 * command that started them.
 * @param briefs - brief paths, or `-` for stdin
 * @param options - caller options, shared by every run
 * @returns 0 once every run is started, else the highest exit code of a run that could not start
 */
export async function start(briefs: string[], options: RunOptions): Promise<number> {
    let prepared: Status[]

    try {
        prepared = await prepare(briefs, options)
    } catch (error) {
        return refuse(error, options.json)
    }

    const started = await Promise.all(prepared.map(launch))
    const running = started.filter(status => status.outcome === 'running')
    const style = styleFor(process.stdout)
    let code = 0

    for (const status of started) {
        if (status.outcome !== 'running') {
            process.stdout.write(await settledOutput(status, status.outcome, options.json, style))
            code = Math.max(code, exitCode(status.outcome))
        } else if (options.json) {
            process.stdout.write(jsonLine(status, status.outcome))
        } else {
            process.stdout.write(
                `${style.mark(true)}Started ${style.bold(status.id)} ${style.dim(`(${status.provider}/${status.model}, ${status.profile} profile)`)}: ${status.title}\n`,
            )
        }
    }

    if (running.length > 0 && !options.json) {
        process.stdout.write(
            `Watch with: ${style.cyan(`${commandName()} watch ${running.map(status => status.id).join(' ')}`)}\n`,
        )
    }

    return code
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
