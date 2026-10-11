import { join } from 'node:path'

import { PrerequisiteError } from './processes'

/**
 * Read the exact Bun version used by CI and both native lab hosts.
 * @returns package.json's pinned Bun version
 */
export async function pinnedBunVersion(): Promise<string> {
    const manifest = (await Bun.file(join(process.cwd(), 'package.json')).json()) as {
        packageManager?: string
    }
    const version = /^bun@(\d+\.\d+\.\d+)$/.exec(manifest.packageManager ?? '')?.[1]

    if (!version) {
        throw new PrerequisiteError('package.json packageManager must pin bun@<version>')
    }

    return version
}

/**
 * Refuse a local compiler that would produce a different build from the pinned toolchain.
 * @param actual - current runtime version
 * @param pinned - package manager pin
 * @returns nothing when versions match
 */
export function requirePinnedBun(actual: string, pinned: string): void {
    if (actual !== pinned) {
        throw new PrerequisiteError(`Local Bun ${actual} differs from package.json pin ${pinned}`)
    }
}
