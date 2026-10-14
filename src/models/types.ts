import type { Static } from 'typebox'

import type { THINKING_LEVELS } from './constants'
import type { KeySchema, ModelSchema, ProviderSchema, RoleSchema } from './schema'

export type Thinking = (typeof THINKING_LEVELS)[number]

/**
 * Where ft reads a provider's credential; the credential itself never appears in config.
 */
export type KeySource = Static<typeof KeySchema>

/**
 * One model a provider serves: Pi's models.json model definition, plus ft's adapter.
 */
export type ModelEntry = Static<typeof ModelSchema>

/**
 * One configured provider: a Pi built-in named by its id, or a custom endpoint.
 */
export type Provider = Static<typeof ProviderSchema>

/**
 * A named model choice; `model` is a `provider/model` reference.
 */
export type Role = Static<typeof RoleSchema>

/**
 * The model one run uses, resolved against the configured providers.
 */
export interface Selection {
    /** Configured provider id. */
    provider: string
    /** The provider's model id. */
    model: string
    /** Requested Pi thinking level, absent when not explicitly selected. */
    thinking?: Thinking
    /** The configured model entry; absent for a built-in catalog model. */
    entry?: ModelEntry
}
