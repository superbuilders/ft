import type { Static } from 'typebox'

import type { Target } from '../../system/host/types'
import type { ConfigSchema } from './schema'

/**
 * The project's `.ft.json`: which providers ft may reach and which model each role uses.
 */
export type Config = Static<typeof ConfigSchema>

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
    /** Directory containing the selected config; a key command runs here. */
    root: string
    /** Where runs live and instructions are read from (see workspaceOf). */
    workspace: string
    /** Validated on-disk configuration. */
    config: Config
}

/**
 * What a project takes from one release, each file checked against the release manifest.
 */
export interface Release {
    /** The runner version and per-target checksums. */
    lock: Lock
    /** The config JSON Schema. */
    schema: string
    /** The shim, written as the repository launcher; fetched only when asked for. */
    launcher?: string
}
