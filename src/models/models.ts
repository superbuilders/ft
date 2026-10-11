import { DEFAULT_LANE, MODEL_CATALOG, THINKING_LEVELS, TOOL_FREE_MODELS } from './constants'

import type { Lane, Thinking } from './types'

/**
 * Validate a thinking level before Pi can silently clamp an invalid value.
 * @param value - requested level
 * @returns the validated level
 */
function thinkingLevel(value: string): Thinking {
    if (!THINKING_LEVELS.includes(value as Thinking)) {
        throw new Error(`Invalid thinking level: ${value}`)
    }

    return value as Thinking
}

/**
 * Validate a lane's exact catalog identity.
 * @param lane - lane JSON object
 * @returns validated model and optional thinking
 */
export function validateLane(lane: Record<string, unknown>): Lane {
    if (typeof lane.model !== 'string' || !MODEL_CATALOG.some(model => model.id === lane.model)) {
        throw new Error('Lane requires an exact catalog model id')
    }

    if (lane.thinking !== undefined && typeof lane.thinking !== 'string') {
        throw new Error('Lane thinking must be a string')
    }

    return {
        model: lane.model,
        ...(lane.thinking === undefined ? {} : { thinking: thinkingLevel(lane.thinking) }),
    }
}

/**
 * Resolve one lane or one exact model, with an explicit thinking override.
 * @param lanes - the project's lanes over the defaults
 * @param lane - lane name; the default lane when neither lane nor model is given
 * @param model - exact model id, chosen instead of a lane
 * @param thinking - optional override
 * @returns the selected model and level
 */
export function resolveLane(
    lanes: Record<string, Lane>,
    lane?: string,
    model?: string,
    thinking?: string,
): Lane {
    const selected = model ? validateLane({ model }) : lanes[lane ?? DEFAULT_LANE]

    if (!selected) {
        throw new Error(`Unknown lane: ${lane}`)
    }

    return { ...selected, ...(thinking === undefined ? {} : { thinking: thinkingLevel(thinking) }) }
}

/**
 * Whether a catalog model can call tools.
 * @param model - exact catalog model id
 * @returns false for a tool-free model
 */
export function supportsTools(model: string): boolean {
    return !TOOL_FREE_MODELS.includes(model)
}
