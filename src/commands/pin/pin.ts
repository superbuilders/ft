import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { findConfig } from '../../project/config/config'
import { CONFIG_FILE, LAUNCHER_FILE, LOCK_FILE } from '../../project/config/constants'
import {
    fetchRelease,
    starterConfig,
    writeRelease,
    writeStarterConfig,
} from '../../project/config/release'

/**
 * Pin a release: write its checksums to the lock and its config schema beside it, and update the
 * repository launcher when there is one. All come from the pinned release, so they always match
 * the runner the launcher will start. A directory with no config also gets an empty one.
 * @param version - exact runner release version
 * @returns completion of pin publication
 */
export async function pin(version: string): Promise<void> {
    const found = findConfig(process.cwd(), process.env.FT_CONFIG)
    const root = found ? dirname(found) : process.cwd()
    const release = await fetchRelease(
        version,
        existsSync(join(root, LAUNCHER_FILE)) ? ['launcher'] : [],
    )

    await writeRelease(root, release)

    const started = await writeStarterConfig(root, await starterConfig())

    process.stderr.write(
        `Pinned ft ${version} in ${join(root, LOCK_FILE)}${started ? `; add a provider and a code lane to ${CONFIG_FILE}` : ''}\n`,
    )
}
