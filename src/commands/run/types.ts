import type { Provider, Selection } from '../../models/types'
import type { Adapter } from '../../pi/gateway/adapters/types'
import type { Outcome } from '../../project/runs/types'

/**
 * Commander inputs, validated before a run is created.
 */
export interface RunOptions {
    /** Brief file path relative to invocation cwd, or `-` to read it from stdin. */
    brief: string
    /** Readable part of the run id; defaults to the brief file's name. */
    name?: string
    /** Optional path that receives the answer on success and is removed when the run fails. */
    out?: string
    /** Requested lane name. */
    lane?: string
    /** `provider/model` reference, chosen instead of a lane. */
    model?: string
    /** Directory the run's tools work in. */
    cwd?: string
    /** Tool allowlist profile, read by default. */
    profile?: string
    /** Requested Pi thinking level. */
    thinking?: string
    /** Optional wall-clock deadline in seconds. */
    deadline?: string
    /** Print the status as JSON instead of the report. */
    json?: boolean
}

/**
 * The run's resolved model and what follows from it.
 */
export interface ModelChoice {
    /** Provider, model and thinking level. */
    selected: Selection
    /** The selected provider's config. */
    provider: Provider
    /** The provider's resolved URL; absent for a built-in provider using Pi's endpoint. */
    baseUrl?: string
    /** The model entry's adapter; absent when Pi reads the provider directly. */
    adapter?: Adapter
    /** Pi tools the run allows: the profile's, or none for a tool-free model. */
    tools: readonly string[]
}

/**
 * What Pi's process and events decided, before the run applies its own interruptions and saves
 * the answer.
 */
export interface Judged {
    /** Pi's exit code; null when a signal ended it. */
    piExitCode: number | null
    /** The signal that ended Pi, if one did. */
    signal: string | null
    /** The verdict from Pi's events and exit. */
    outcome: Outcome
    /** The protocol or model error behind a failed verdict. */
    error: string | null
}
