import { createWriteStream } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { finished } from 'node:stream/promises'

import { resolveLane } from '../../models/models'
import { prepareAgent } from '../../pi/agent/agent'
import { serveKey } from '../../pi/agent/key-broker'
import { createJudge, judgeOutcome } from '../../pi/events/judge'
import { adapterNamed } from '../../pi/gateway/adapters'
import { serveGateway } from '../../pi/gateway/gateway'
import { filterEnvironment } from '../../pi/process/environment'
import { runPi } from '../../pi/process/spawn'
import { installRuntime } from '../../pi/runtime/runtime'
import { loadConfig } from '../../project/config/config'
import { collectContext } from '../../project/context/context'
import { atomicWrite } from '../../system/files/atomic-write'
import { cacheRoot, platformTarget } from '../../system/host/host'
import { CANCEL_SIGNALS, PROFILE_TOOLS } from './constants'
import { exitCode, initialStatus, publish, writeStatus } from './status'

import type { Config } from '../../project/config/types'
import type { ModelChoice, Outcome, RunOptions, Status } from './types'

/**
 * Resolve the run's model, its provider and adapter, and the tools Pi may use.
 * @param options - caller options
 * @param config - the project's validated config
 * @returns everything the run needs to know about its model
 */
function chooseModel(options: RunOptions, config: Config): ModelChoice {
    const allowed = PROFILE_TOOLS[options.profile ?? 'read']

    if (!allowed) {
        throw new Error('--profile must be read or write')
    }

    if (options.lane && options.model) {
        throw new Error('Choose at most one of --lane or --model')
    }

    const selected = resolveLane(
        config.providers,
        config.lanes,
        options.lane,
        options.model,
        options.thinking,
    )
    const adapter = selected.entry?.adapter ? adapterNamed(selected.entry.adapter) : undefined

    return {
        selected,
        provider: config.providers[selected.provider],
        ...(adapter ? { adapter } : {}),
        tools: adapter?.tools === false ? [] : allowed,
    }
}

/**
 * Validate one brief and execute its selected transport with private state cleanup.
 * @param options - caller options
 * @param status - terminal snapshot to update
 * @param controller - cancellation owner
 * @param streams - protocol and diagnostics destinations
 * @returns authoritative answer text
 */
async function execute(
    options: RunOptions,
    status: Status,
    controller: AbortController,
    streams: {
        events: ReturnType<typeof createWriteStream>
        stderr: ReturnType<typeof createWriteStream>
    },
): Promise<string> {
    const cwd = status.cwd
    const { events, stderr } = streams
    let dir: string | undefined
    let closeKey: (() => Promise<void>) | undefined
    let stopGateway: (() => Promise<void>) | undefined
    let text = ''

    try {
        const config = await loadConfig(process.cwd())
        const { selected, provider, adapter, tools } = chooseModel(options, config.config)

        status.provider = selected.provider
        status.model = selected.model
        status.thinking = selected.thinking ?? null

        const brief = await readFile(resolve(options.brief), 'utf8')

        if (!brief.trim()) {
            throw new Error('Brief must not be empty')
        }

        const context = await collectContext(config.root, cwd)

        status.outcome = 'runtime_error'
        controller.signal.throwIfAborted()

        const root = cacheRoot()
        const runtime = await installRuntime(root, tools.length > 0, controller.signal)

        await mkdir(join(root, 'runs'), { recursive: true, mode: 0o700 })
        dir = await mkdtemp(join(root, 'runs', 'run-'))

        let baseUrl: string | undefined

        if (adapter && provider.baseUrl) {
            const gateway = serveGateway(provider.baseUrl, adapter)

            stopGateway = gateway.stop
            baseUrl = gateway.url
        }

        const privatePaths = await prepareAgent(
            dir,
            { id: selected.provider, provider, ...(baseUrl ? { baseUrl } : {}) },
            context,
        )
        const socket = join(dir, 'key.sock')

        closeKey = serveKey(
            socket,
            { provider: selected.provider, source: provider.key, root: config.root },
            controller.signal,
        )

        const state = createJudge()
        const env = filterEnvironment(
            process.env,
            Object.values(config.config.providers).flatMap(({ key }) =>
                'env' in key ? [key.env] : [],
            ),
        )

        env.FT_CONFIG = config.path
        env.FT_KEY_SOCKET = socket

        const result = await runPi({
            ...runtime,
            ...privatePaths,
            cwd,
            brief,
            selected,
            tools,
            env,
            state,
            signal: controller.signal,
            events: chunk => {
                events.write(chunk)
            },
            stderr: chunk => {
                stderr.write(chunk)
            },
        })

        text = state.text
        Object.assign(status, {
            piExitCode: result.code,
            signal: result.signal,
            settled: state.settled,
            stopReason: state.stopReason,
            retryCount: state.retryCount,
            compactionCount: state.compactionCount,
            toolErrorCount: state.toolErrorCount,
            outcome: judgeOutcome(state, result.code, result.signal),
            error: state.protocolError ?? state.modelError,
        })

        return text
    } finally {
        if (closeKey) {
            await closeKey()
        }

        if (stopGateway) {
            await stopGateway()
        }

        if (dir) {
            await rm(dir, { recursive: true, force: true })
        }
    }
}

/**
 * Run one brief, own cancellation and write a terminal status on every path.
 * @param options - public run options
 * @returns normalized public exit code
 */
export async function run(options: RunOptions): Promise<number> {
    const start = Date.now()
    const out = resolve(options.out)
    const cwd = resolve(options.cwd ?? process.cwd())
    const status = initialStatus(options, cwd)
    const controller = new AbortController()
    let interrupted: Outcome | undefined
    let stopping: Promise<void> | undefined

    /**
     * Persist interruption before aborting the runtime.
     * @param outcome - public interruption verdict
     * @returns nothing
     */
    function stop(outcome: 'timeout' | 'cancelled'): void {
        if (interrupted) {
            return
        }

        interrupted = outcome
        status.outcome = outcome
        status.error = outcome === 'timeout' ? 'Deadline exceeded' : 'Caller cancelled the run'
        status.durationMs = Date.now() - start
        stopping = writeStatus(out, status).finally(() => controller.abort())
    }

    /**
     * Convert caller signals into normalized cancellation.
     * @returns nothing
     */
    function interrupt(): void {
        stop('cancelled')
    }

    for (const signal of CANCEL_SIGNALS) {
        process.on(signal, interrupt)
    }

    let timer: ReturnType<typeof setTimeout> | undefined
    let text = ''

    await atomicWrite(`${out}.events.jsonl`, '')
    await atomicWrite(`${out}.stderr.log`, '')

    const events = createWriteStream(`${out}.events.jsonl`, { flags: 'a', mode: 0o600 })
    const stderr = createWriteStream(`${out}.stderr.log`, { flags: 'a', mode: 0o600 })

    try {
        platformTarget()

        if (options.deadline !== undefined) {
            const seconds = Number(options.deadline)

            if (!Number.isFinite(seconds) || seconds <= 0 || seconds * 1000 > 2_147_483_647) {
                throw new Error('--deadline must be positive seconds within the timer range')
            }

            timer = setTimeout(
                () => stop('timeout'),
                Math.max(1, seconds * 1000 - (Date.now() - start)),
            )
        }

        text = await execute(options, status, controller, { events, stderr })
    } catch (error) {
        if (status.outcome !== 'configuration_error') {
            status.outcome = 'runtime_error'
        }

        status.error = error instanceof Error ? error.message : 'Runner failed'
        stderr.write(`${status.error}\n`)
    } finally {
        if (timer) {
            clearTimeout(timer)
        }

        if (stopping) {
            await stopping
        }

        for (const signal of CANCEL_SIGNALS) {
            process.off(signal, interrupt)
        }

        events.end()
        stderr.end()
        await Promise.all([finished(events), finished(stderr)])
    }

    if (interrupted) {
        status.outcome = interrupted
        status.error = interrupted === 'timeout' ? 'Deadline exceeded' : 'Caller cancelled the run'
    }

    status.durationMs = Date.now() - start

    await publish(out, text, status)
    process.stderr.write(
        `${status.outcome} ${status.provider ?? 'unknown'}/${status.model ?? 'unknown'} ${status.durationMs}ms ${out}\n`,
    )

    return exitCode(status.outcome)
}
