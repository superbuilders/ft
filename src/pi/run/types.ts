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

/**
 * Where one steering message stands: sent to Pi, queued by Pi, seen by the model, or never.
 */
export type SteerState = 'sent' | 'queued' | 'delivered' | 'undelivered' | 'refused'

/**
 * One line of a run's steers.jsonl: a steering message changing state.
 */
export interface SteerRecord {
    /** The steer's number in this run, from 1. */
    id: number
    /** When the state changed (ISO 8601). */
    at: string
    /** The state it reached. */
    state: SteerState
    /** The message, on its first record. */
    message?: string
    /** Why it was refused or not delivered. */
    reason?: string
}

/**
 * What `ft steer` hears back.
 */
export interface SteerReceipt {
    /** The steer's number in this run; absent when it was refused before getting one. */
    id?: number
    /** Queued, already delivered, or refused or undelivered with a reason. */
    state: SteerState
    /** Why it was refused or not delivered. */
    reason?: string
}

/**
 * What ft made of a final answer that must match an --output-schema.
 */
export type OutputCheck =
    | {
          /** The answer holds exactly one object that matches. */
          ok: true
          /** That object. */
          value: Record<string, unknown>
          /** Whether ft found it inside prose or fences rather than as the whole message. */
          recovered: boolean
      }
    | {
          /** No usable object, or more than one. */
          ok: false
          /** What is wrong, one problem per entry, for a correction or the run's error. */
          problems: string[]
      }

/**
 * A subschema directly under a schema in an output schema.
 */
export interface SchemaChild {
    /** The subschema. */
    schema: unknown
    /** Whether it applies to the same value as its parent, as allOf's entries do. */
    same: boolean
    /** Whether it is a definition, which applies only where a reference points. */
    definition: boolean
    /** Its JSON pointer below the parent, such as `/properties/name`. */
    pointer: string
}
