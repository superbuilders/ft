import type { Lane, Provider } from '../../models/types'
import type { Target } from '../../system/host/types'

/**
 * The project's `.ft.json`: which providers ft may reach and which model each lane uses.
 */
export interface Config {
    /** Providers by id: a Pi built-in id, or a custom endpoint. */
    providers: Record<string, Provider>
    /** Named model choices; `code` is the default lane. */
    lanes: Record<string, Lane>
}

/**
 * The project's `.ft/lock.json`: the pinned runner, read by the shim before ft starts.
 */
export interface Lock {
    /** Exact release version; never a floating tag. */
    version: string
    /** Lowercase release-archive digests for every runner target. */
    sha256: Record<Target, string>
}

/**
 * A validated config and where it was found.
 */
export interface ResolvedConfig {
    /** Absolute discovered .ft.json path. */
    path: string
    /** Project directory containing the selected config. */
    root: string
    /** Validated on-disk configuration. */
    config: Config
}
