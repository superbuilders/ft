import { createWriteStream } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { hostname } from 'node:os'
import { join } from 'node:path'
import { finished } from 'node:stream/promises'

import { compactionReserve } from '../../models/models'
import { loadConfig } from '../../project/config/config'
import { collectContext } from '../../project/context/context'
import { getKey } from '../../project/key/key'
import { RUN_FILES } from '../../project/runs/constants'
import { publisher, saveText } from '../../project/runs/lifecycle'
import { readRequest, readStatus } from '../../project/runs/store'
import { cacheRoot } from '../../system/host/host'
import { prepareAgent } from '../agent/agent'
import { serveKey } from '../agent/key-broker'
import { createJudge, judgeOutcome } from '../events/judge'
import { serveGateway } from '../gateway/gateway'
import { filterEnvironment } from '../process/environment'
import { runPi } from '../process/spawn'
import { installRuntime } from '../runtime/runtime'
import { CANCEL_SIGNALS, CONTROL_SOCKET, RUN_PROFILES } from './constants'
import { chooseModel } from './model'
import { createSteering, serveSteering } from './steering'

import type { Outcome, Request, Status } from '../../project/runs/types'
import type { JudgeState } from '../events/types'
import type { Steering } from './steering'
import type { Judged } from './types'

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
 * @param control.steering - messages from `ft steer`, passed to Pi while it works
 * @returns Pi's exit and the judged outcome
 */
async function drive(
    request: Request,
    status: Status,
    state: JudgeState,
    phase: { failure: Outcome },
    control: { signal: AbortSignal; touch: () => void; steering: Steering },
): Promise<Judged> {
    const { signal, touch, steering } = control
    const { dir } = status
    const config = await loadConfig(process.cwd())
    const { selected, provider, baseUrl, adapter, tools } = chooseModel(request, config.config)
    const [brief, key, repository] = await Promise.all([
        readFile(join(dir, RUN_FILES.brief), 'utf8'),
        getKey(provider.key, config.root, signal),
        collectContext(config.workspace, request.cwd),
    ])
    const context = `${RUN_PROFILES[request.profile].preamble}\n\n${repository}`

    phase.failure = 'runtime_error'
    signal.throwIfAborted()

    const root = cacheRoot()
    const runtime = await installRuntime(root, tools.length > 0, signal)
    const events = createWriteStream(join(dir, RUN_FILES.events), { mode: 0o600 })
    const stderr = createWriteStream(join(dir, RUN_FILES.stderr), { mode: 0o600 })
    let scratch: string | undefined
    let closeKey: (() => Promise<void>) | undefined
    let closeSteering: (() => Promise<void>) | undefined
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
            compactionReserve(selected, provider),
        )
        const socket = join(scratch, 'key.sock')

        closeKey = serveKey(socket, { provider: selected.provider, value: key })

        const env = filterEnvironment(
            process.env,
            Object.values(config.config.providers).flatMap(({ key: source }) =>
                'env' in source ? [source.env] : [],
            ),
        )

        env.FT_KEY_SOCKET = socket

        const controlSocket = join(scratch, CONTROL_SOCKET)

        closeSteering = serveSteering(controlSocket, steering)
        status.control = controlSocket
        touch()

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
            control: steering.control,
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
        delete status.control
        await steering.close('the run ended before the model read it')
        await closeSteering?.()
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
 * Execute a prepared run to its verdict, in this process: it owns cancellation and the deadline,
 * keeps status.json current while Pi works, and always writes a final status.
 * @param dir - the run's folder
 * @returns the settled status
 */
export async function execute(dir: string): Promise<Status> {
    const status = await readStatus(dir)

    if (!status) {
        throw new Error(`no run status in ${dir}`)
    }

    const request = await readRequest(dir)
    const controller = new AbortController()
    const state = createJudge(status)
    const live = publisher(status)
    const steering = createSteering(join(dir, RUN_FILES.steers))
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
            steering,
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
        contextOverflow: state.contextOverflow,
    }
    const steers = steering.counts()

    if (steers.delivered + steers.undelivered > 0) {
        decided.steers = steers
    }

    if (interrupted) {
        decided.outcome = interrupted
        decided.error =
            interrupted === 'timeout' ? 'Deadline exceeded' : 'The run was stopped by a signal'
    }

    if (decided.outcome !== 'success') {
        decided.error ??= `Run ended with outcome ${decided.outcome} (stop reason ${decided.stopReason}, Pi exit code ${decided.piExitCode})`
    }

    try {
        await saveText(decided, { answer: state.text, partial: state.lastText }, request.out)
    } catch (error) {
        Object.assign(decided, {
            outcome: 'runtime_error',
            answer: null,
            error: `could not save the answer: ${error instanceof Error ? error.message : 'unknown error'}`,
        })
    }

    Object.assign(status, decided)
    await live.flush()

    return status
}
