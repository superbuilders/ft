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
import { CANCEL_SIGNALS, CONTROL_SOCKET, OUTPUT_CORRECTIONS_MAX, RUN_PROFILES } from './constants'
import { chooseModel } from './model'
import {
    checkOutput,
    compileOutputSchema,
    correctionMessage,
    outputInstructions,
    problemList,
} from './output'
import { createSteering, serveSteering } from './steering'

import type { Outcome, Request, Status } from '../../project/runs/types'
import type { JudgeState } from '../events/types'
import type { Steering } from './steering'
import type { Judged, OutputSchema } from './types'

/**
 * A run's output schema and the corrections sent so far, shared by the run and its Pi session.
 */
interface OutputState {
    /** The compiled --output-schema; absent when the run has none, or before Pi starts. */
    schema?: OutputSchema
    /** Corrections sent so far. */
    corrections: number
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
 * @param control.steering - messages from `ft steer`, passed to Pi while it works
 * @param control.output - the run's output schema, compiled here, and the corrections sent
 * @returns Pi's exit and the judged outcome
 */
async function drive(
    request: Request,
    status: Status,
    state: JudgeState,
    phase: { failure: Outcome },
    control: { signal: AbortSignal; touch: () => void; steering: Steering; output: OutputState },
): Promise<Judged> {
    const { signal, touch, steering, output } = control
    const { dir } = status
    const config = await loadConfig(process.cwd())
    const { selected, provider, baseUrl, adapter, tools } = chooseModel(request, config.config)
    const [brief, key, repository] = await Promise.all([
        readFile(join(dir, RUN_FILES.brief), 'utf8'),
        getKey(provider.key, config.root, signal),
        collectContext(config.workspace, request.cwd),
    ])
    const context = `${RUN_PROFILES[request.profile].preamble}\n\n${repository}`

    output.schema = request.outputSchema ? compileOutputSchema(request.outputSchema) : undefined

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
            brief: output.schema ? brief + outputInstructions(output.schema) : brief,
            selected,
            tools,
            env,
            state,
            progress: touch,
            control: steering.control,
            settled: () => correction(state, output),
            signal,
            events: line => {
                events.write(`${line}\n`)
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
 * When Pi settles with a finished answer that does not match the output schema, the correction
 * to send, while corrections remain.
 * @param state - the judge, holding the final answer
 * @param output - the run's output schema and the corrections sent
 * @returns the correction, or undefined to let Pi end
 */
function correction(state: JudgeState, output: OutputState): string | undefined {
    if (!output.schema || state.aborted || state.stopReason !== 'stop') {
        return undefined
    }

    const checked = checkOutput(state.text, output.schema)

    if (checked.ok || output.corrections >= OUTPUT_CORRECTIONS_MAX) {
        return undefined
    }

    output.corrections++

    return correctionMessage(checked.problems)
}

/**
 * Decide a run's answer under its output schema: a successful run's answer becomes the object,
 * formatted, and one with no matching object becomes invalid_output.
 * @param decided - the final status, updated in place
 * @param text - the model's final message
 * @param output - the run's output schema and the corrections sent
 * @returns the text to save as the answer
 */
function outputAnswer(decided: Status, text: string, output: OutputState): string {
    if (!output.schema) {
        return text
    }

    decided.corrections = output.corrections

    if (decided.outcome !== 'success') {
        return text
    }

    const checked = checkOutput(text, output.schema)

    if (!checked.ok) {
        const sent = `${output.corrections} ${output.corrections === 1 ? 'correction' : 'corrections'}`

        decided.outcome = 'invalid_output'
        decided.error = `the answer did not match the output schema after ${sent}: ${problemList(checked.problems)}`

        return text
    }

    decided.recovered = checked.recovered

    return `${JSON.stringify(checked.value, null, 4)}\n`
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
    const output: OutputState = { corrections: 0 }
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
            output,
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
    const answer = outputAnswer(decided, state.text, output)
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
        await saveText(
            decided,
            {
                answer,
                partial: state.lastText,
                file: output.schema ? RUN_FILES.output : RUN_FILES.answer,
            },
            request.out,
        )
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
