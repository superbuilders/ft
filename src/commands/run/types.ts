import type { Verdict } from '../../pi/events/types'

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
    /** Exact built-in catalog id; fuzzy selection is forbidden. */
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
    /** Custom provider id, fixed to truefoundry. */
    provider: string
    /** Exact built-in catalog id; fuzzy selection is forbidden. */
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
