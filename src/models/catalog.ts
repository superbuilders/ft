import { getBuiltinModel, getBuiltinProviders } from '@earendil-works/pi-ai/providers/all'

import type { KnownProvider } from '@earendil-works/pi-ai'

/**
 * Whether Pi ships a provider under this id.
 * @param id - provider id from config
 * @returns true for one of Pi's built-in providers
 */
export function isBuiltinProvider(id: string): id is KnownProvider {
    return getBuiltinProviders().includes(id as KnownProvider)
}

/**
 * Whether Pi's offline catalog lists a model for a built-in provider.
 * @param provider - built-in provider id
 * @param model - the provider's model id
 * @returns true when Pi knows the model
 */
export function isBuiltinModel(provider: KnownProvider, model: string): boolean {
    /*
     * Pi's lookup is typed for known ids; config ids are arbitrary strings. Comparing the id also
     * rejects inherited keys like `constructor`.
     */
    const entry = getBuiltinModel(provider, model as never) as { id?: string } | undefined

    return entry?.id === model
}
