import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, delimiter, join, resolve as resolvePath } from 'node:path'

import { LAUNCHER_MARKER } from './constants'

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

/**
 * Show a path the way people type it, with `~` for the home directory.
 * @param path - absolute path
 * @returns the path, starting with `~/` when it is under home
 */
export function tildePath(path: string): string {
    const home = homeDirectory()

    return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path
}

/**
 * Find the ft launcher the installer put on PATH, skipping anything else named ft.
 * @returns its path, or undefined when PATH has none
 */
export async function installedLauncher(): Promise<string | undefined> {
    for (const directory of (process.env.PATH ?? '').split(delimiter).filter(Boolean)) {
        const path = join(directory, 'ft')

        /* A repository's .ft/ft carries the same marker, but it belongs to the repository. */
        if (basename(directory) === '.ft' || !existsSync(path)) {
            continue
        }

        /* The marker is on the launcher's second line; a binary named ft is not read whole. */
        const head = await Bun.file(path).slice(0, 64).text()

        if (head.includes(LAUNCHER_MARKER)) {
            return path
        }
    }

    return undefined
}
