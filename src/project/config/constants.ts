export const CONFIG_FILE = '.ft.json'

/** Pinned runner version and checksums, beside the config; only `ft pin` writes it. */
export const LOCK_FILE = '.ft/lock.json'

/** The repository launcher `ft init` writes: the shim, run through a package script or by path. */
export const LAUNCHER_FILE = '.ft/ft'

/** JSON Schema for the config, from the pinned release; `.ft.json` points at it with `$schema`. */
export const SCHEMA_FILE = '.ft/schema.json'

/** Fields a provider may not set: ft brokers every credential through the provider's `key`. */
export const FORBIDDEN_PROVIDER_FIELDS = ['apiKey', 'oauth'] as const

/** GitHub repository that publishes ft releases. */
export const RELEASE_REPOSITORY = 'superbuilders/ft'

/** Release assets ft reads besides the runner checksums. */
export const RELEASE_ASSETS = {
    schema: 'schema.json',
    launcher: 'ft-shim',
    installer: 'install.sh',
} as const

/** Where `ft skill` puts the agent skill, relative to the repository or home directory. */
export const SKILL_PATH = '.agents/skills/ft/SKILL.md'
