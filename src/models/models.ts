import { MODEL_CATALOG, THINKING_LEVELS } from './constants'

import type { Lane, Thinking } from './types'

/**
 * Validate a thinking level before Pi can silently clamp an invalid value.
 * @param value - requested level
 * @returns the validated level
 */
export function thinkingLevel(value: string): Thinking {
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
