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
        throw new Error(`unsupported platform: ${os}-${arch}`)
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
 * Resolve the state directory, which holds the runs of repositories set up only by the personal config.
 * @returns absolute ft state root
 */
export function stateRoot(): string {
    return resolvePath(process.env.XDG_STATE_HOME || join(homeDirectory(), '.local', 'state'), 'ft')
}

/**
 * Resolve the personal config directory, used where a project has no `.ft.json` of its own.
 * @returns absolute ft config directory
 */
export function configRoot(): string {
    return resolvePath(process.env.XDG_CONFIG_HOME || join(homeDirectory(), '.config'), 'ft')
}

/**
 * Show a path the way people type it, with `~` for the home directory.
 * @param path - absolute path
 * @returns the path, starting with `~/` when it is under home
 */
export function tildePath(path: string): string {
    const home = homeDirectory()

    return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path
}
