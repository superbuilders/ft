import { existsSync } from 'node:fs'
import { basename, delimiter, join } from 'node:path'

import { LAUNCHER_MARKER } from './constants'

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
