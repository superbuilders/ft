export const CONFIG_FILE = '.ft.json'

/** Pinned runner version and checksums, beside the config; only `ft pin` writes it. */
export const LOCK_FILE = '.ft.lock'

/** Fields a provider may not set: ft brokers every credential through the provider's `key`. */
export const FORBIDDEN_PROVIDER_FIELDS = ['apiKey', 'oauth'] as const
