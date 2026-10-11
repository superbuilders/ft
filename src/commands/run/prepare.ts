import { existsSync, statSync } from 'node:fs'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { hostname } from 'node:os'
import { join, resolve } from 'node:path'

import { DEFAULT_LANE } from '../../models/constants'
import { resolveLane } from '../../models/models'
import { adapterNamed } from '../../pi/gateway/adapters'
import { PROFILE_TOOLS } from '../../pi/process/constants'
import { PI_VERSION } from '../../pi/runtime/constants'
import { loadConfig, resolveBaseUrl } from '../../project/config/config'
import { getKey } from '../../project/key/key'
import { RUN_FILES } from '../../project/runs/constants'
import {
    briefTitle,
    createRun,
    emptyProgress,
    runName,
    writeRequest,
    writeStatus,
} from '../../project/runs/store'
import { platformTarget } from '../../system/host/host'
import { DEADLINE_MAX_SECONDS } from './constants'

import type { Config } from '../../project/config/types'
import type { Request, Status } from '../../project/runs/types'
import type { ModelChoice, RunOptions } from './types'

/**
 * Resolve the run's model, its provider and adapter, and the tools Pi may use.
 * @param request - the run's request
 * @param config - the project's validated config
 * @returns everything the run needs to know about its model
 */
export function chooseModel(request: Omit<Request, 'cwd'>, config: Config): ModelChoice {
    const allowed = PROFILE_TOOLS[request.profile]

    if (!allowed) {
        throw new Error(`--profile must be one of ${Object.keys(PROFILE_TOOLS).join(', ')}`)
    }

    if (request.lane && request.model) {
        throw new Error('Choose at most one of --lane or --model')
    }

    const selected = resolveLane(
        config.providers,
        config.lanes,
        request.lane,
        request.model,
        request.thinking,
    )
    const adapter = selected.entry?.adapter ? adapterNamed(selected.entry.adapter) : undefined
    const provider = config.providers[selected.provider]
    const baseUrl = resolveBaseUrl(selected.provider, provider)

    return {
        selected,
        provider,
        ...(baseUrl ? { baseUrl } : {}),
        ...(adapter ? { adapter } : {}),
        tools: adapter?.tools === false ? [] : allowed,
    }
}

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
        throw new Error(`--deadline must be positive seconds, at most ${DEADLINE_MAX_SECONDS}`)
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
        throw new Error(brief === '-' ? 'The brief on stdin is empty' : `Brief ${brief} is empty`)
    }

    return text
}

/**
 * Check everything that can be checked before work starts, then create the run: its folder, its
 * request, its brief and a first status. A mistake here never leaves a run behind. Any file at
 * --out goes first, so that path holds an answer only when this run succeeded.
 * @param options - caller options
 * @returns the new run's first status
 */
export async function prepare(options: RunOptions): Promise<Status> {
    if (options.out) {
        await rm(resolve(options.out), { force: true })
    }

    platformTarget()

    const config = await loadConfig(process.cwd())
    const cwd = resolve(options.cwd ?? process.cwd())

    if (!existsSync(cwd) || !statSync(cwd).isDirectory()) {
        throw new Error(`--cwd ${cwd} is not a directory`)
    }

    const deadline = deadlineSeconds(options.deadline)
    const request: Request = {
        profile: options.profile ?? 'read',
        cwd,
        ...(options.lane ? { lane: options.lane } : {}),
        ...(options.model ? { model: options.model } : {}),
        ...(options.thinking ? { thinking: options.thinking } : {}),
        ...(deadline === undefined ? {} : { deadline }),
        ...(options.out ? { out: resolve(options.out) } : {}),
    }
    const { selected, provider } = chooseModel(request, config.config)

    /* A key in the environment costs nothing to check now; a key command runs once, in the run. */
    if ('env' in provider.key) {
        await getKey(provider.key, config.root)
    }

    const brief = await readBrief(options.brief)

    const { id, dir } = await createRun(config.root, runName(options.name, options.brief))
    const now = new Date().toISOString()
    const status: Status = {
        schemaVersion: 2,
        id,
        dir,
        title: briefTitle(brief),
        outcome: 'running',
        piVersion: PI_VERSION,
        lane: request.model ? null : (request.lane ?? DEFAULT_LANE),
        provider: selected.provider,
        model: selected.model,
        thinking: selected.thinking ?? null,
        profile: request.profile,
        cwd,
        pid: null,
        host: hostname(),
        startedAt: now,
        updatedAt: now,
        piExitCode: null,
        signal: null,
        settled: false,
        stopReason: null,
        retryCount: 0,
        compactionCount: 0,
        toolErrorCount: 0,
        durationMs: 0,
        error: null,
        answer: null,
        partial: null,
        ...emptyProgress(),
    }

    await writeFile(join(dir, RUN_FILES.brief), brief, { mode: 0o600 })
    await writeRequest(dir, request)
    await writeStatus(status)

    return status
}
