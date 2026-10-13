import { isBuiltinModel, isBuiltinProvider } from './catalog'
import { DEFAULT_LANE, THINKING_LEVELS } from './constants'

import type { Lane, Provider, Selection, Thinking } from './types'

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
 * Resolve one lane or one exact model, with an explicit thinking override.
 * @param providers - configured providers by id
 * @param lanes - configured lanes by name
 * @param lane - lane name; the default lane when neither lane nor model is given
 * @param model - `provider/model` reference, chosen instead of a lane
 * @param thinking - optional override
 * @returns the selected model and level
 */
export function resolveLane(
    providers: Record<string, Provider>,
    lanes: Record<string, Lane>,
    lane?: string,
    model?: string,
    thinking?: string,
): Selection {
    const name = lane ?? DEFAULT_LANE
    const chosen = model ? { model } : lanes[name]

    if (!chosen) {
        const known = Object.keys(lanes)

        throw new Error(
            known.length > 0
                ? `.ft.json has no lane named ${name} (its lanes are ${known.join(', ')})`
                : `.ft.json defines no lanes (add one named ${name} under "lanes")`,
        )
    }

    const level = thinking ?? chosen.thinking

    return {
        ...findModel(providers, chosen.model),
        ...(level === undefined ? {} : { thinking: thinkingLevel(level) }),
    }
}
