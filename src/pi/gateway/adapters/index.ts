import { sonar } from './sonar'

import type { Adapter } from './types'

/** Every adapter ft ships, by the name a model entry's `adapter` field uses. */
const ADAPTERS: Readonly<Record<string, Adapter>> = { sonar }

/**
 * Find the adapter a model entry names.
 * @param name - the model entry's adapter name
 * @returns the adapter
 */
export function adapterNamed(name: string): Adapter {
    const adapter = ADAPTERS[name]

    if (!adapter) {
        throw new Error(`unknown adapter ${name} (ft ships ${Object.keys(ADAPTERS).join(', ')})`)
    }

    return adapter
}
