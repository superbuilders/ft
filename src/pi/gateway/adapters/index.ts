import { sonar } from './sonar'

import type { Adapter } from './types'

/** Every adapter ft ships; a catalog model with no entry here talks to the gateway unchanged. */
const ADAPTERS: readonly Adapter[] = [sonar]

/**
 * Find the adapter for one catalog model.
 * @param model - exact catalog model id
 * @returns the model's adapter, or undefined when it needs none
 */
export function adapterFor(model: string): Adapter | undefined {
    return ADAPTERS.find(adapter => adapter.models.includes(model))
}
