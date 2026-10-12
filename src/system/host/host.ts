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
 * The person's home directory, from HOME first as a POSIX shell would read it.
 * @returns absolute home directory
 */
export function homeDirectory(): string {
    return process.env.HOME || homedir()
}

/**
 * Resolve the shared cache layout.
 * @returns absolute ft cache root
 */
export function cacheRoot(): string {
    return resolvePath(process.env.XDG_CACHE_HOME || join(homeDirectory(), '.cache'), 'ft')
}

/**
 * Resolve the personal config directory, used where a project has no `.ft.json` of its own.
 * @returns absolute ft config directory
 */
export function configRoot(): string {
    return resolvePath(process.env.XDG_CONFIG_HOME || join(homeDirectory(), '.config'), 'ft')
}
