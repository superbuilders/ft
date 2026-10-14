import type { Selection } from '../../models/types'

/**
 * A run's stored verdict. `running` until the run settles; a reader turns a `running` run whose
 * process has vanished into `lost`, which is never stored.
 */
export type Outcome =
    | 'running'
    | 'success'
    | 'model_error'
    | 'incomplete'
    | 'protocol_error'
    | 'runtime_error'
    | 'configuration_error'
    | 'timeout'
    | 'cancelled'

/**
 * What a reader reports: the stored outcome, or `lost` for a run that died without one.
 */
export type State = Outcome | 'lost'

/**
 * Tokens and cost summed over the run's model calls.
 */
export interface Usage {
    /** Prompt tokens not served from cache. */
    input: number
    /** Completion tokens, reasoning included. */
    output: number
    /** Prompt tokens served from cache. */
    cacheRead: number
    /** Prompt tokens written to cache. */
    cacheWrite: number
    /** Dollars, as priced by the model entry; 0 when the entry declares no cost. */
    cost: number
}

/**
 * What the run has done so far, kept current while it works.
 */
export interface Progress {
    /** Model turns started. */
    turns: number
    /** Tokens and cost so far. */
    usage: Usage
    /** Tool calls by tool name. */
    tools: Record<string, number>
    /** Paths the edit and write tools touched, as the model wrote them, first touch first. */
    files: string[]
    /** One line on what the run is doing now, or did last. */
    activity: string | null
}

/**
 * The caller's request, stored with the run so it can be executed detached and read back later.
 */
export interface Request {
    /** Role name; absent for an explicit model. */
    role?: string
    /** `provider/model` reference, chosen instead of a role. */
    model?: string
    /** Tool profile. */
    profile: string
    /** Thinking override. */
    thinking?: string
    /** Wall-clock seconds before the run is stopped. */
    deadline?: number
    /** Absolute directory the run's tools work in. */
    cwd: string
    /** Absolute path that also receives the answer on success. */
    out?: string
}

/**
 * The run's status file, rewritten while the run works and once when it settles.
 */
export interface Status extends Progress {
    /** Wire schema discriminator. */
    schemaVersion: 2
    /** The run's id, also its folder name under `.ft/runs`. */
    id: string
    /** Absolute path of the run's folder. */
    dir: string
    /** First line of the brief, for lists. */
    title: string
    /** Runner verdict, independent of Pi's exit code. */
    outcome: Outcome
    /** Pinned Pi release this runner drives. */
    piVersion: string
    /** Role the run used; null for an explicit model. */
    role: string | null
    /** Configured provider id; null until the model is resolved. */
    provider: string | null
    /** The provider's model id; null until the model is resolved. */
    model: string | null
    /** Requested thinking level; null when the model's default applies. */
    thinking: string | null
    /** Tool profile. */
    profile: string
    /** Absolute directory the run's tools work in. */
    cwd: string
    /** The process executing the run; null before it starts. */
    pid: number | null
    /** Host of that process, so a reader on another host does not judge it lost. */
    host: string
    /** When the run started (ISO 8601). */
    startedAt: string
    /** When this file was last written (ISO 8601). */
    updatedAt: string
    /** Pi's exit code; null before Pi exits. */
    piExitCode: number | null
    /** Signal that ended Pi, if any. */
    signal: string | null
    /** Whether Pi finished its automatic recovery work. */
    settled: boolean
    /** Last assistant stop reason, if observed. */
    stopReason: string | null
    /** Retries Pi scheduled. */
    retryCount: number
    /** Context compactions Pi ran. */
    compactionCount: number
    /** Tool calls that failed. */
    toolErrorCount: number
    /** Milliseconds from start to now, or to the verdict. */
    durationMs: number
    /** Why the run failed; null while running and on success. */
    error: string | null
    /** Whether the failure was the model's context window overflowing; absent in runs from before ft recorded it. */
    contextOverflow?: boolean
    /** Absolute path of the answer; null unless the run succeeded. */
    answer: string | null
    /** Absolute path of the last unfinished answer text kept from a failed run; null otherwise. */
    partial: string | null
    /** The socket `ft steer` talks to, while the run takes steers; absent otherwise. */
    control?: string
    /** How many steers reached the model and how many did not; absent when none were sent. */
    steers?: { delivered: number; undelivered: number }
}

/**
 * What creating a run needs to know: its name, the brief, the request, and the model chosen.
 */
export interface OpenRun {
    /** Readable part of the id. */
    name: string
    /** Brief text, saved beside the run. */
    brief: string
    /** The validated request. */
    request: Request
    /** Provider, model and thinking level. */
    selected: Selection
    /** Pi version the run uses. */
    piVersion: string
}
