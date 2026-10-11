import type { THINKING_LEVELS } from './constants'

export type Thinking = (typeof THINKING_LEVELS)[number]

/**
 * Exact model selection shared by defaults, overrides and CLI resolution.
 */
export interface Lane {
    /** Exact built-in catalog id; fuzzy selection is forbidden. */
    model: string
    /** Requested Pi thinking level, absent when not explicitly selected. */
    thinking?: Thinking
}
