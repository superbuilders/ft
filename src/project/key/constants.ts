/** How long `ft doctor` waits for a provider to answer the key check. */
export const PROBE_TIMEOUT_MS = 5000

/** The Anthropic API version header the key check sends. */
export const ANTHROPIC_VERSION = '2023-06-01'

/** Statuses that mean the provider refused the credential, not that something else went wrong. */
export const REJECTED_STATUSES: readonly number[] = [401, 403]
