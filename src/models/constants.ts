import type { KnownApi, ModelThinkingLevel } from '@earendil-works/pi-ai'

export const THINKING_LEVELS = [
    'off',
    'minimal',
    'low',
    'medium',
    'high',
    'xhigh',
    'max',
] as const satisfies readonly ModelThinkingLevel[]

/** Wire protocols a custom provider can speak; Pi's extensions add others, and ft disables extensions. */
export const KNOWN_APIS = [
    'openai-completions',
    'mistral-conversations',
    'openai-responses',
    'azure-openai-responses',
    'openai-codex-responses',
    'anthropic-messages',
    'bedrock-converse-stream',
    'google-generative-ai',
    'google-vertex',
    'pi-messages',
] as const satisfies readonly KnownApi[]

/** How long a run's conversation grows, in tokens, before Pi summarizes its older turns. */
export const DEFAULT_COMPACT_AT = 400_000

/** The context window Pi assumes for a model whose entry gives none. */
export const PI_DEFAULT_CONTEXT_WINDOW = 128_000

/** The latest conversation Pi keeps word for word when it compacts, in tokens. */
export const PI_KEEP_RECENT_TOKENS = 20_000

/**
 * The lowest compaction point ft accepts: twice what Pi keeps, so a compacted run has as much room
 * again to work before it compacts next, instead of compacting every turn.
 */
export const MIN_COMPACT_AT = 2 * PI_KEEP_RECENT_TOKENS

/** The room Pi keeps free for the model's reply by default; ft never compacts later than Pi would. */
export const PI_DEFAULT_RESERVE_TOKENS = 16_384

/** Longest deadline the timer can hold, in seconds. */
export const DEADLINE_MAX_SECONDS = 2_147_483

/** The role a run uses when the caller names neither a role nor a model. */
export const DEFAULT_ROLE = 'code'

/** A minimal working config, shown wherever ft finds no roles: one key from the environment, one from a command. */
export const EXAMPLE_CONFIG = `{
    "providers": {
        "anthropic": { "key": { "env": "ANTHROPIC_API_KEY" } },
        "openai": { "key": { "command": ["op", "read", "op://vault/openai/key"] } }
    },
    "roles": {
        "code": { "model": "anthropic/claude-opus-5-5", "thinking": "high" }
    }
}`
