import type { Provider, Selection } from '../../models/types'
import type { Outcome } from '../../project/runs/types'
import type { Adapter } from '../gateway/adapters/types'

/**
 * What one --profile gives the delegate.
 */
export interface RunProfile {
    /** Pi tools the delegate may use. */
    tools: readonly string[]
    /** Standing instructions placed before the repository's own. */
    preamble: string
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
