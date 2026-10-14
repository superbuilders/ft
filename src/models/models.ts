import { builtinContextWindow, isBuiltinModel, isBuiltinProvider } from './catalog'
import {
    DEFAULT_COMPACT_AT,
    DEFAULT_ROLE,
    EXAMPLE_CONFIG,
    PI_DEFAULT_CONTEXT_WINDOW,
    PI_DEFAULT_RESERVE_TOKENS,
    THINKING_LEVELS,
} from './constants'

import type { Role, Provider, Selection, Thinking } from './types'

/**
 * Validate a thinking level before Pi can silently clamp an invalid value.
 * @param value - requested level
 * @returns the validated level
 */
function thinkingLevel(value: string): Thinking {
    if (!THINKING_LEVELS.includes(value as Thinking)) {
        throw new Error(
            `invalid thinking level ${value} (choose one of ${THINKING_LEVELS.join(', ')})`,
        )
    }

    return value as Thinking
}

/**
 * Find a `provider/model` reference among the configured providers.
 * @param providers - configured providers by id
 * @param ref - provider id and model id, joined by the first slash
 * @returns the provider, model and configured entry
 */
export function findModel(providers: Record<string, Provider>, ref: string): Selection {
    const slash = ref.indexOf('/')
    const provider = ref.slice(0, slash)
    const model = ref.slice(slash + 1)

    if (slash <= 0 || !model) {
        throw new Error(`model ${ref} must be written as provider/model`)
    }

    const config = providers[provider]

    if (!config) {
        throw new Error(
            `model ${ref} names provider ${provider}, which .ft.json does not configure`,
        )
    }

    const entry = config.models?.find(candidate => candidate.id === model)

    if (!entry && !(isBuiltinProvider(provider) && isBuiltinModel(provider, model))) {
        const ids = config.models?.map(candidate => candidate.id) ?? []

        throw new Error(
            ids.length > 0
                ? `provider ${provider} has no model ${model} (it configures ${ids.join(', ')})`
                : `provider ${provider} has no model ${model}`,
        )
    }

    return { provider, model, ...(entry ? { entry } : {}) }
}

/**
 * The room Pi keeps free in the context window, which sets when it compacts: Pi summarizes once the
 * conversation outgrows the window minus this reserve, so compacting at N tokens means a reserve of
 * window - N. The window is the one Pi resolves: the provider's override wins; otherwise an entry's
 * own window, which Pi defaults to 128000 rather than the catalog's; otherwise the catalog's.
 * @param selected - the run's model
 * @param provider - the model's provider config
 * @returns Pi's reserveTokens setting
 */
export function compactionReserve(selected: Selection, provider: Provider): number {
    const override = provider.modelOverrides?.[selected.model]?.contextWindow
    const configured = selected.entry
        ? selected.entry.contextWindow
        : builtinContextWindow(selected.provider, selected.model)
    const window =
        (typeof override === 'number' ? override : undefined) ??
        configured ??
        PI_DEFAULT_CONTEXT_WINDOW
    const compactAt = selected.entry?.compactAt ?? DEFAULT_COMPACT_AT

    return Math.max(PI_DEFAULT_RESERVE_TOKENS, window - compactAt)
}

/**
 * Resolve one role or one exact model, with an explicit thinking override.
 * @param providers - configured providers by id
 * @param roles - configured roles by name
 * @param role - role name; the default role when neither role nor model is given
 * @param model - `provider/model` reference, chosen instead of a role
 * @param thinking - optional override
 * @returns the selected model and level
 */
export function resolveRole(
    providers: Record<string, Provider>,
    roles: Record<string, Role>,
    role?: string,
    model?: string,
    thinking?: string,
): Selection {
    const name = role ?? DEFAULT_ROLE
    const chosen = model ? { model } : roles[name]

    if (!chosen) {
        const known = Object.keys(roles)

        throw new Error(
            known.length > 0
                ? `.ft.json has no role named ${name} (its roles are ${known.join(', ')})`
                : `.ft.json defines no roles (add one named ${name} under "roles", as in this minimal config)\n\n${EXAMPLE_CONFIG}`,
        )
    }

    const level = thinking ?? chosen.thinking

    return {
        ...findModel(providers, chosen.model),
        ...(level === undefined ? {} : { thinking: thinkingLevel(level) }),
    }
}
