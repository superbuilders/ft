import { readFile, rm, stat } from 'node:fs/promises'
import { resolve } from 'node:path'

import { chooseModel } from '../../pi/run/model'
import { compileOutputSchema } from '../../pi/run/output'
import { PI_VERSION } from '../../pi/runtime/constants'
import { loadConfig } from '../../project/config/config'
import { getKey } from '../../project/key/key'
import { DEFAULT_KEEP_DAYS } from '../../project/runs/constants'
import { openRun } from '../../project/runs/lifecycle'
import { pruneRuns, runName } from '../../project/runs/store'
import { platformTarget } from '../../system/host/host'
import { DEADLINE_MAX_SECONDS } from './constants'

import type { Request, Status } from '../../project/runs/types'
import type { RunOptions } from './types'

/**
 * Validate the caller's deadline.
 * @param deadline - seconds as typed
 * @returns seconds, or undefined when none was given
 */
function deadlineSeconds(deadline: string | undefined): number | undefined {
    if (deadline === undefined) {
        return undefined
    }

    const seconds = Number(deadline)

    if (!Number.isFinite(seconds) || seconds <= 0 || seconds > DEADLINE_MAX_SECONDS) {
        throw new Error(
            `--deadline must be a positive number of seconds, at most ${DEADLINE_MAX_SECONDS}`,
        )
    }

    return seconds
}

/**
 * Read the brief from its file, or from stdin for `-`.
 * @param brief - path or `-`
 * @returns non-empty brief text
 */
async function readBrief(brief: string): Promise<string> {
    const text =
        brief === '-'
            ? await new Response(Bun.stdin.stream()).text()
            : await readFile(resolve(brief), 'utf8')

    if (!text.trim()) {
        throw new Error(brief === '-' ? 'the brief on stdin is empty' : `brief ${brief} is empty`)
    }

    return text
}

/**
 * Read and check the caller's output schema, so a schema ft would misread refuses the runs
 * instead of failing or passing every answer.
 * @param file - the --output-schema path as typed
 * @returns the schema, or undefined when none was given
 */
async function outputSchema(
    file: string | undefined,
): Promise<Record<string, unknown> | undefined> {
    if (file === undefined) {
        return undefined
    }

    const text = await readFile(resolve(file), 'utf8').catch(() => {
        throw new Error(`--output-schema ${file} could not be read`)
    })
    let schema: unknown

    try {
        schema = JSON.parse(text)
    } catch (error) {
        throw new Error(
            `--output-schema ${file} is not JSON: ${error instanceof Error ? error.message : 'unreadable'}`,
            { cause: error },
        )
    }

    try {
        compileOutputSchema(schema)

        return schema as Record<string, unknown>
    } catch (error) {
        throw new Error(
            `--output-schema ${file}: ${error instanceof Error ? error.message : 'invalid'}`,
            { cause: error },
        )
    }
}

/**
 * The folder a run works in: the caller's, or the one --workdir names.
 * @param dir - the --workdir value, relative to the working directory
 * @returns its absolute path
 */
async function runFolder(dir: string | undefined): Promise<string> {
    if (dir === undefined) {
        return process.cwd()
    }

    const folder = resolve(dir)
    const found = await stat(folder).catch(() => null)

    if (!found?.isDirectory()) {
        throw new Error(`--workdir ${dir} is not a folder`)
    }

    return folder
}

/**
 * Check everything that can be checked before work starts, for every brief, then create one run
 * per brief: its folder, its request, its brief and a first status. A mistake in any brief leaves
 * no run behind. Any file at --out goes first, so that path holds an answer only when this run
 * succeeded.
 * @param briefs - brief paths relative to the working directory, or `-` for stdin
 * @param options - caller options, shared by every run
 * @returns each new run's first status, in brief order
 */
export async function prepare(briefs: string[], options: RunOptions): Promise<Status[]> {
    if (briefs.length > 1 && (options.name || options.out)) {
        throw new Error('--name and --out work only with a single brief')
    }

    if (briefs.filter(brief => brief === '-').length > 1) {
        throw new Error('only one brief can come from stdin')
    }

    platformTarget()

    const config = await loadConfig(process.cwd())
    const deadline = deadlineSeconds(options.deadline)
    const schema = await outputSchema(options.outputSchema)
    const request: Request = {
        profile: options.profile ?? 'read',
        cwd: await runFolder(options.workdir),
        ...(options.role ? { role: options.role } : {}),
        ...(options.model ? { model: options.model } : {}),
        ...(options.thinking ? { thinking: options.thinking } : {}),
        ...(deadline === undefined ? {} : { deadline }),
        ...(options.out ? { out: resolve(options.out) } : {}),
        ...(schema ? { outputSchema: schema } : {}),
    }
    const { selected, provider } = chooseModel(request, config.config)

    /* A key in the environment costs nothing to check now; a key command runs once, in the run. */
    if ('env' in provider.key) {
        await getKey(provider.key, config.root)
    }

    const runs = await Promise.all(
        briefs.map(async brief => ({
            name: runName(options.name, brief),
            brief: await readBrief(brief),
            request,
            selected,
            piVersion: PI_VERSION,
        })),
    )

    /* Only once the run is accepted, so a refused run leaves the old file alone. */
    if (options.out) {
        await rm(resolve(options.out), { force: true })
    }

    /* New runs are too young to prune, so cleanup need not hold them up. */
    const [statuses] = await Promise.all([
        Promise.all(runs.map(run => openRun(config.runs, run))),
        pruneRuns(config.runs, config.config.runs?.keepDays ?? DEFAULT_KEEP_DAYS),
    ])

    return statuses
}
