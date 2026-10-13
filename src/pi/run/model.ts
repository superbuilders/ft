import { resolveLane } from '../../models/models'
import { resolveBaseUrl } from '../../project/config/config'
import { adapterNamed } from '../gateway/adapters'
import { RUN_PROFILES } from './constants'

import type { Config } from '../../project/config/types'
import type { Request } from '../../project/runs/types'
import type { ModelChoice } from './types'

/**
 * Resolve the run's model, its provider and adapter, and the tools Pi may use.
 * @param request - the run's request
 * @param config - the project's validated config
 * @returns everything the run needs to know about its model
 */
export function chooseModel(request: Omit<Request, 'cwd'>, config: Config): ModelChoice {
    const profile = RUN_PROFILES[request.profile]

    if (!profile) {
        throw new Error(`--profile must be one of ${Object.keys(RUN_PROFILES).join(', ')}`)
    }

    if (request.lane && request.model) {
        throw new Error('--lane and --model cannot be used together')
    }

    const selected = resolveLane(
        config.providers,
        config.lanes,
        request.lane,
        request.model,
        request.thinking,
    )
    const adapter = selected.entry?.adapter ? adapterNamed(selected.entry.adapter) : undefined
    const provider = config.providers[selected.provider]
    const baseUrl = resolveBaseUrl(selected.provider, provider)

    return {
        selected,
        provider,
        ...(baseUrl ? { baseUrl } : {}),
        ...(adapter ? { adapter } : {}),
        tools: adapter?.tools === false ? [] : profile.tools,
    }
}
