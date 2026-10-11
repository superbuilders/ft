import type { Provider, Selection } from '../../models/types'
import type { Verdict } from '../../pi/events/types'
import type { Adapter } from '../../pi/gateway/adapters/types'

export type Outcome = Verdict | 'configuration_error' | 'timeout' | 'cancelled'

/**
 * Commander inputs validated before spawning the model runtime.
 */
export interface RunOptions {
    /** Brief file path relative to invocation cwd. */
    brief: string
    /** Answer destination relative to invocation cwd. */
    out: string
    /** Requested lane name; null for explicit model selection. */
    lane?: string
    /** `provider/model` reference, chosen instead of a lane. */
    model?: string
    /** Explicit tool working directory, absolute in status. */
    cwd?: string
    /** Tool allowlist profile, read by default. */
    profile?: string
    /** Requested Pi thinking level, absent when not explicitly selected. */
    thinking?: string
    /** Optional wall-clock seconds supplied by the caller. */
    deadline?: string
}

/**
 * Schema-versioned terminal result persisted independently of the answer.
 */
export interface Status {
    /** Wire schema discriminator, currently fixed to 1. */
    schemaVersion: 1
    /** Runner verdict, independent of Pi process exit code. */
    outcome: Outcome
    /** Pinned Pi release associated with this runner. */
    piVersion: string
    /** Lane the run used; null for explicit model selection. */
    lane: string | null
    /** Configured provider id; null until the model is resolved. */
    provider: string | null
    /** The provider's model id; null until the model is resolved. */
    model: string | null
    /** Requested Pi thinking level, absent when not explicitly selected. */
    thinking: string | null
    /** Explicit tool working directory, absolute in status. */
    cwd: string
    /** Actual Pi exit code; null before Pi starts. */
    piExitCode: number | null
    /** Actual Pi termination signal, if any. */
    signal: string | null
    /** Whether the agent finished automatic recovery work. */
    settled: boolean
    /** Last authoritative assistant stop reason, if observed. */
    stopReason: string | null
    /** Number of scheduled assistant and summarization retries. */
    retryCount: number
    /** Number of compaction_start records observed. */
    compactionCount: number
    /** Number of failed tool_execution_end records. */
    toolErrorCount: number
    /** Elapsed wall-clock milliseconds including startup and shutdown. */
    durationMs: number
    /** Failure diagnostic, null on successful runs. */
    error: string | null
}

/**
 * The run's resolved model and what follows from it.
 */
export interface ModelChoice {
    /** Provider, model and thinking level. */
    selected: Selection
    /** The selected provider's config. */
    provider: Provider
    /** The model entry's adapter; absent when Pi reads the provider directly. */
    adapter?: Adapter
    /** Pi tools the run allows: the profile's, or none for a tool-free model. */
    tools: readonly string[]
}
