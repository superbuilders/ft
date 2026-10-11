import type { Lane } from '../../models/types'
import type { Target } from '../../system/host/types'

export type ApiKey = { command: string[] } | { env: string }

/**
 * Binding on-disk project schema consumed by both shim and runner.
 */
export interface Config {
    /** Exact release version; never a floating tag. */
    version: string
    /** Trusted archive digest, or all four runner target digests in project config. */
    sha256: Record<Target, string>
    /** Credential reference only; never an inline key. */
    apiKey: ApiKey
    /** Optional gateway URL override. */
    gateway?: { baseUrl: string }
    /** Named exact-model selections, merged over built-in lanes. */
    lanes?: Record<string, Lane>
}

/**
 * Validated project configuration with runner defaults applied.
 */
export interface ResolvedConfig {
    /** Absolute discovered .ft.json path. */
    path: string
    /** Project directory containing the selected config. */
    root: string
    /** Validated on-disk configuration. */
    config: Config
    /** HTTP(S) gateway root without credentials or query parameters. */
    baseUrl: string
    /** Named exact-model selections, merged over built-in lanes. */
    lanes: Record<string, Lane>
}
