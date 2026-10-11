import type { KNOWN_APIS, THINKING_LEVELS } from './constants'

export type Thinking = (typeof THINKING_LEVELS)[number]

export type ProviderApi = (typeof KNOWN_APIS)[number]

/**
 * Where ft reads a provider's credential; the credential itself never appears in config.
 */
export type KeySource = { env: string } | { command: string[] }

/**
 * One model a provider serves: Pi's models.json model definition, plus ft's adapter.
 */
export interface ModelEntry {
    /** The provider's model id, sent on the wire. */
    id: string
    /** Name of the ft adapter that translates this model's traffic; absent when Pi reads it directly. */
    adapter?: string
    /** Every other Pi model field, passed to Pi unchanged. */
    [field: string]: unknown
}

/**
 * One configured provider: a Pi built-in named by its id, or a custom endpoint.
 */
export interface Provider {
    /** Credential source, brokered to Pi as `ft key <provider>`. */
    key: KeySource
    /** Endpoint root including any version path, or the variable holding it; required for a custom provider. */
    baseUrl?: string | { env: string }
    /** Wire protocol; required for a custom provider. */
    api?: ProviderApi
    /** Models in Pi's format; required for a custom provider, extra models for a built-in. */
    models?: ModelEntry[]
    /** Every other Pi provider field, passed to Pi unchanged. */
    [field: string]: unknown
}

/**
 * A named model choice; `model` is a `provider/model` reference.
 */
export interface Lane {
    /** Provider id and that provider's model id, joined by the first slash. */
    model: string
    /** Requested Pi thinking level, absent when not explicitly selected. */
    thinking?: Thinking
}

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
