import { createWriteStream } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { hostname } from 'node:os'
import { join } from 'node:path'
import { finished } from 'node:stream/promises'

import { prepareAgent } from '../../pi/agent/agent'
import { serveKey } from '../../pi/agent/key-broker'
import { createJudge, judgeOutcome } from '../../pi/events/judge'
import { serveGateway } from '../../pi/gateway/gateway'
import { filterEnvironment } from '../../pi/process/environment'
import { runPi } from '../../pi/process/spawn'
import { installRuntime } from '../../pi/runtime/runtime'
import { loadConfig } from '../../project/config/config'
import { collectContext } from '../../project/context/context'
import { getKey } from '../../project/key/key'
import { RUN_FILES } from '../../project/runs/constants'
import { readRequest, readStatus, writeStatus } from '../../project/runs/store'
import { atomicWrite } from '../../system/files/atomic-write'
import { cacheRoot } from '../../system/host/host'
import { CANCEL_SIGNALS, DELEGATE_PREAMBLE, STATUS_INTERVAL_MS } from './constants'
import { chooseModel } from './prepare'

import type { JudgeState } from '../../pi/events/types'
import type { Outcome, Request, Status } from '../../project/runs/types'
import type { Judged } from './types'

/**
 * Publish status changes at most once per interval, and on demand.
 * @param status - the live status
 * @returns a nudge for each change and a flush for the end
 */
function publisher(status: Status): { touch: () => void; flush: () => Promise<void> } {
    let timer: ReturnType<typeof setTimeout> | undefined
    let writing = Promise.resolve()

    /**
     * Queue one write behind any in flight, so writes never interleave.
     * @returns the queued write
     */
    function write(): Promise<void> {
        status.durationMs = Date.now() - Date.parse(status.startedAt)
        writing = writing.then(() => writeStatus(status)).catch(() => {})

        return writing
    }

    return {
        touch() {
            timer ??= setTimeout(() => {
                timer = undefined
                void write()
            }, STATUS_INTERVAL_MS)
        },
        async flush() {
            clearTimeout(timer)
            timer = undefined
            await write()
        },
    }
}

/**
 * Drive Pi for the run: resolve the key, gather context, start Pi, and judge what it did.
 * @param request - the run's request
 * @param status - the live status; its progress fields stay current while Pi works
 * @param state - the protocol judge, which keeps the status's progress
 * @param phase - which outcome a failure means so far: configuration until Pi is ready to start
 * @param phase.failure - the outcome to record if the run fails now
 * @param control - how the run is steered from outside
 * @param control.signal - cancellation
 * @param control.touch - publishes a status change
 * @returns Pi's exit and the judged outcome
 */
async function drive(
    request: Request,
    status: Status,
    state: JudgeState,
    phase: { failure: Outcome },
    control: { signal: AbortSignal; touch: () => void },
): Promise<Judged> {
    const { signal, touch } = control
    const { dir } = status
    const config = await loadConfig(process.cwd())
    const { selected, provider, baseUrl, adapter, tools } = chooseModel(request, config.config)
    const [brief, key, repository] = await Promise.all([
        readFile(join(dir, RUN_FILES.brief), 'utf8'),
        getKey(provider.key, config.root, signal),
        collectContext(config.root, request.cwd),
    ])
    const context = `${DELEGATE_PREAMBLE[request.profile]}\n\n${repository}`

    phase.failure = 'runtime_error'
    signal.throwIfAborted()

    const root = cacheRoot()
    const runtime = await installRuntime(root, tools.length > 0, signal)
    const events = createWriteStream(join(dir, RUN_FILES.events), { mode: 0o600 })
    const stderr = createWriteStream(join(dir, RUN_FILES.stderr), { mode: 0o600 })
    let scratch: string | undefined
    let closeKey: (() => Promise<void>) | undefined
    let gateway: ReturnType<typeof serveGateway> | undefined

    try {
        await mkdir(join(root, 'runs'), { recursive: true, mode: 0o700 })
        scratch = await mkdtemp(join(root, 'runs', 'run-'))

        if (adapter && baseUrl) {
            gateway = serveGateway(baseUrl, adapter)
        }

        const target = gateway?.url ?? baseUrl
        const privatePaths = await prepareAgent(
            scratch,
            { id: selected.provider, provider, ...(target ? { baseUrl: target } : {}) },
            context,
        )
        const socket = join(scratch, 'key.sock')

        closeKey = serveKey(socket, { provider: selected.provider, value: key })

        const env = filterEnvironment(
            process.env,
            Object.values(config.config.providers).flatMap(({ key: source }) =>
                'env' in source ? [source.env] : [],
            ),
        )

        env.FT_CONFIG = config.path
        env.FT_KEY_SOCKET = socket

        const result = await runPi({
            ...runtime,
            ...privatePaths,
            cwd: request.cwd,
            brief,
            selected,
            tools,
            env,
            state,
            progress: touch,
            signal,
            events: chunk => {
                events.write(chunk)
            },
            stderr: chunk => {
                stderr.write(chunk)
            },
        })

        return {
            piExitCode: result.code,
            signal: result.signal,
            outcome: judgeOutcome(state, result.code, result.signal),
            error: state.protocolError ?? state.modelError,
        }
    } finally {
        await closeKey?.()
        await gateway?.stop()

        if (scratch) {
            await rm(scratch, { recursive: true, force: true })
        }

        events.end()
        stderr.end()
        await Promise.all([finished(events), finished(stderr)])
    }
}

/**
 * Keep the run's answer, or the last thing a failed run's model said.
 * @param request - the run's request
 * @param status - status with its outcome decided, updated with the path written
 * @param state - the judge holding the model's text
 * @returns completion
 */
async function keepText(request: Request, status: Status, state: JudgeState): Promise<void> {
    if (status.outcome === 'success') {
        const answer = join(status.dir, RUN_FILES.answer)

        await atomicWrite(answer, state.text)

        if (request.out) {
            await atomicWrite(request.out, state.text)
        }

        status.answer = answer
    } else if (state.lastText.trim()) {
        const partial = join(status.dir, RUN_FILES.partial)

        await atomicWrite(partial, state.lastText)
        status.partial = partial
    }
}

/**
 * Execute a prepared run to its verdict, in this process: it owns cancellation and the deadline,
 * keeps status.json current while Pi works, and always writes a final status.
 * @param dir - the run's folder
 * @returns the settled status
 */
export async function execute(dir: string): Promise<Status> {
    const status = await readStatus(dir)

    if (!status) {
        throw new Error(`${dir} holds no run`)
    }

    const request = await readRequest(dir)
    const controller = new AbortController()
    const state = createJudge(status)
    const live = publisher(status)
    const phase: { failure: Outcome } = { failure: 'configuration_error' }
    let judged: Judged | undefined
    let failure: string | undefined
    let interrupted: Outcome | undefined
    let timer: ReturnType<typeof setTimeout> | undefined

    Object.assign(status, { pid: process.pid, host: hostname() })
    await live.flush()

    /**
     * Record why the run stops, then stop Pi.
     * @param outcome - timeout or cancellation
     * @returns nothing
     */
    function stop(outcome: 'timeout' | 'cancelled'): void {
        interrupted ??= outcome
        controller.abort()
    }

    /**
     * Treat a caller's signal as cancellation.
     * @returns nothing
     */
    function cancel(): void {
        stop('cancelled')
    }

    for (const signal of CANCEL_SIGNALS) {
        process.on(signal, cancel)
    }

    if (request.deadline !== undefined) {
        timer = setTimeout(
            () => stop('timeout'),
            Math.max(1, request.deadline * 1000 - (Date.now() - Date.parse(status.startedAt))),
        )
    }

    try {
        judged = await drive(request, status, state, phase, {
            signal: controller.signal,
            touch: live.touch,
        })
    } catch (error) {
        failure = error instanceof Error ? error.message : 'Runner failed'
    } finally {
        clearTimeout(timer)

        for (const signal of CANCEL_SIGNALS) {
            process.off(signal, cancel)
        }
    }

    /*
     * The status stays running until the answer is on disk, so no reader sees a success it cannot
     * collect; every field below lands in the one final write.
     */
    const decided: Status = {
        ...status,
        ...judged,
        outcome: judged?.outcome ?? phase.failure,
        error: judged ? judged.error : (failure ?? null),
        settled: state.settled,
        stopReason: state.stopReason,
        retryCount: state.retryCount,
        compactionCount: state.compactionCount,
        toolErrorCount: state.toolErrorCount,
    }

    if (interrupted) {
        decided.outcome = interrupted
        decided.error = interrupted === 'timeout' ? 'Deadline exceeded' : 'Caller cancelled the run'
    }

    if (decided.outcome !== 'success') {
        decided.error ??= `Run ended ${decided.outcome} (stopReason ${decided.stopReason}, Pi exit ${decided.piExitCode})`
    }

    try {
        await keepText(request, decided, state)
    } catch (error) {
        Object.assign(decided, {
            outcome: 'runtime_error',
            answer: null,
            error: `Could not save the answer: ${error instanceof Error ? error.message : 'unknown error'}`,
        })
    }

    Object.assign(status, decided)
    await live.flush()

    return status
}
