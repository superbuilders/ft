import { DEFAULT_LANE } from '../../models/constants'
import { PI_VERSION } from '../../pi/runtime/constants'
import { atomicWrite } from '../../system/files/atomic-write'

import type { Outcome, RunOptions, Status } from './types'

/**
 * Make the initial status before config validation so failures also have outputs.
 * @param options - public CLI options
 * @param cwd - absolute run directory
 * @returns initial status snapshot
 */
export function initialStatus(options: RunOptions, cwd: string): Status {
    return {
        schemaVersion: 1,
        outcome: 'configuration_error',
        piVersion: PI_VERSION,
        lane: options.model ? null : (options.lane ?? DEFAULT_LANE),
        provider: 'truefoundry',
        model: options.model ?? null,
        thinking: options.thinking ?? null,
        cwd,
        piExitCode: null,
        signal: null,
        settled: false,
        stopReason: null,
        retryCount: 0,
        compactionCount: 0,
        toolErrorCount: 0,
        durationMs: 0,
        error: null,
    }
}

/**
 * Persist the versioned terminal status, separate from protocol and diagnostic streams.
 * @param out - answer path
 * @param status - terminal snapshot
 * @returns completion of status publication
 */
export async function writeStatus(out: string, status: Status): Promise<void> {
    await atomicWrite(`${out}.status.json`, `${JSON.stringify(status, null, 4)}\n`)
}

/**
 * Publish a successful answer and persist the terminal verdict even on answer-write failure.
 * @param out - answer destination
 * @param text - authoritative answer
 * @param status - terminal snapshot
 * @returns completion of output publication
 */
export async function publish(out: string, text: string, status: Status): Promise<void> {
    if (status.outcome === 'success') {
        try {
            await atomicWrite(out, text)
        } catch (error) {
            status.outcome = 'runtime_error'
            status.error = error instanceof Error ? error.message : 'Answer publication failed'
        }
    } else {
        status.error ??= `Run ended ${status.outcome} (stopReason ${status.stopReason}, Pi exit ${status.piExitCode})`
    }

    await writeStatus(out, status)
}

/**
 * Map normalized outcomes to the public exit-code contract.
 * @param outcome - terminal outcome
 * @returns runner exit code
 */
export function exitCode(outcome: Outcome): number {
    return {
        success: 0,
        configuration_error: 2,
        model_error: 1,
        runtime_error: 1,
        incomplete: 3,
        protocol_error: 3,
        timeout: 124,
        cancelled: 130,
    }[outcome]
}
