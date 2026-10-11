import type { TARGETS, THINKING_LEVELS } from './constants'

export type Target = (typeof TARGETS)[number]
export type Thinking = (typeof THINKING_LEVELS)[number]

/**
 * Exact model selection shared by defaults, overrides and CLI resolution.
 */
export interface Lane {
    /** Exact built-in catalog id; fuzzy selection is forbidden. */
    model: string
    /** Requested Pi thinking level, absent when not explicitly selected. */
    thinking?: Thinking
}
export type ApiKey = { command: string[] } | { env: string }

/**
 * Binding on-disk project schema consumed by both shim and runner.
 */
export interface Config {
    /** Exact release version; never a floating tag. */
    version: string
    /** Trusted archive digest, or all four runner target digests in project config. */
    sha256: Record<Target, string>
    /** Credential reference only; never an inline key. */
    apiKey: ApiKey
    /** Optional gateway URL override. */
    gateway?: { baseUrl: string }
    /** Named exact-model selections, merged over built-in lanes. */
    lanes?: Record<string, Lane>
}

/**
 * Validated project configuration with runner defaults applied.
 */
export interface ResolvedConfig {
    /** Absolute discovered .ft.json path. */
    path: string
    /** Project directory containing the selected config. */
    root: string
    /** Validated on-disk configuration. */
    config: Config
    /** HTTP(S) gateway root without credentials or query parameters. */
    baseUrl: string
    /** Named exact-model selections, merged over built-in lanes. */
    lanes: Record<string, Lane>
}

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
export type Outcome =
    | 'success'
    | 'configuration_error'
    | 'model_error'
    | 'incomplete'
    | 'protocol_error'
    | 'timeout'
    | 'cancelled'
    | 'runtime_error'

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
    /** Requested lane name; null for explicit model selection. */
    lane: string | null
    /** Custom provider id, fixed to truefoundry. */
    provider: string
    /** Exact built-in catalog id; fuzzy selection is forbidden. */
    model: string | null
    /** Requested Pi thinking level, absent when not explicitly selected. */
    thinking: string | null
    /** Explicit tool working directory, absolute in status. */
    cwd: string
    /** Actual Pi exit code; null for research or before Pi starts. */
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
 * Mutable protocol evidence; only authoritative messages supply answer text.
 */
export interface JudgeState {
    /** Whether the JSON session header has been parsed. */
    header: boolean
    /** Whether an agent_start record has been observed. */
    started: boolean
    /** Whether the agent finished automatic recovery work. */
    settled: boolean
    /** Pi agent_settled abort indicator. */
    aborted: boolean
    /** Last authoritative assistant stop reason, if observed. */
    stopReason: string | null
    /** All text blocks of the last authoritative assistant, in order. */
    text: string
    /** Last assistant errorMessage, if present. */
    modelError: string | null
    /** First framing or event-shape failure, if any. */
    protocolError: string | null
    /** Number of scheduled assistant and summarization retries. */
    retryCount: number
    /** Number of compaction_start records observed. */
    compactionCount: number
    /** Number of failed tool_execution_end records. */
    toolErrorCount: number
}

/**
 * Pinned archive publication instructions for the generic installer.
 */
export interface InstallSpec {
    /** Protocol lock name, including pinned version. */
    name: string
    /** Immutable published directory under the cache root. */
    finalPath: string
    /** Exact pinned release archive download URL. */
    url: string
    /** Trusted archive digest, or all four runner target digests in project config. */
    sha256: string
    /** Executable path relative to extracted tree root. */
    binary: string
    /** Exact release version; never a floating tag. */
    version: string
}

/**
 * A finished subprocess. Callers decide what may be shown: the key command's
 * pipes can carry the credential, so nothing here is logged.
 */
export interface CommandResult {
    /** Everything the command wrote to stdout, as raw bytes. */
    stdout: Buffer
    /** Everything the command wrote to stderr, as raw bytes. */
    stderr: Buffer
    /** The command's exit status; nonzero means it failed. */
    exitCode: number
}
