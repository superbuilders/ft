import { homedir } from 'node:os'
import { join, resolve as resolvePath } from 'node:path'

import type { Target } from './types'

/**
 * Map runtime platform names to the binding release target.
 * @param os - runtime operating system
 * @param arch - runtime architecture
 * @returns supported release target
 */
export function platformTarget(os = process.platform, arch = process.arch): Target {
    if ((os !== 'darwin' && os !== 'linux') || (arch !== 'arm64' && arch !== 'x64')) {
        throw new Error(`Unsupported platform: ${os}-${arch}`)
    }

    return `${os}-${arch}`
}

/**
 * Resolve the shared cache layout.
 * @returns absolute ft cache root
 */
export function cacheRoot(): string {
    return resolvePath(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'ft')
}
