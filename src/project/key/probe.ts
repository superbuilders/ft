import { getBuiltinModels } from '@earendil-works/pi-ai/providers/all'

import { isBuiltinProvider } from '../../models/catalog'
import { ANTHROPIC_VERSION, PROBE_TIMEOUT_MS, REJECTED_STATUSES } from './constants'

import type { Provider } from '../../models/types'
import type { ListRequest, ProbeResult } from './types'

/**
 * Where the provider lists its models and how it wants the key, for the APIs where that is
 * standard.
 * @param api - the provider's wire protocol
 * @param base - endpoint root
 * @param key - credential
 * @returns the request to send, or null for an API ft does not check
 */
function listRequest(api: string | undefined, base: string, key: string): ListRequest | null {
    const root = base.replace(/\/+$/, '')

    if (api === 'openai-completions' || api === 'openai-responses') {
        return { url: `${root}/models`, headers: { authorization: `Bearer ${key}` } }
    }

    if (api === 'anthropic-messages') {
        return {
            url: `${root}/v1/models`,
            headers: { 'x-api-key': key, 'anthropic-version': ANTHROPIC_VERSION },
        }
    }

    return null
}

/**
 * Ask the provider whether it accepts the key, with one request that lists its models and costs
 * nothing. Never reports the key or the response body.
 * @param id - provider id
 * @param provider - configured provider
 * @param baseUrl - the resolved endpoint, if the config sets one
 * @param key - resolved credential
 * @returns what the provider said
 */
export async function probeKey(
    id: string,
    provider: Provider,
    baseUrl: string | undefined,
    key: string,
): Promise<ProbeResult> {
    const builtin = isBuiltinProvider(id) ? getBuiltinModels(id)[0] : undefined
    const api = provider.api ?? builtin?.api
    const base = baseUrl ?? builtin?.baseUrl

    /* A built-in endpoint with {placeholders} is filled in by Pi from more settings than ft reads. */
    const request = base && !base.includes('{') ? listRequest(api, base, key) : null

    if (!request) {
        return { verdict: 'unchecked', reason: `ft cannot check ${api ?? 'this'} keys` }
    }

    try {
        const response = await fetch(request.url, {
            headers: request.headers,
            signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
        })

        await response.body?.cancel()

        if (response.ok) {
            return { verdict: 'accepted' }
        }

        return REJECTED_STATUSES.includes(response.status)
            ? { verdict: 'rejected', status: response.status }
            : { verdict: 'unchecked', reason: `the model list answered HTTP ${response.status}` }
    } catch {
        return { verdict: 'unchecked', reason: 'the provider did not answer' }
    }
}
