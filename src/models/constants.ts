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
