import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { scopeRoot } from '../../project/config/config'
import { CONFIG_FILE, LAUNCHER_FILE, LOCK_FILE } from '../../project/config/constants'
import { fetchRelease, writeRelease } from '../../project/config/release'

/**
 * Pin a release for one scope: write its checksums to the lock and its config schema beside it,
 * and update the repository launcher when there is one. All come from the pinned release, so they
 * always match the runner the launcher will start. A scope that is not set up is refused, since
 * setting one up is `ft init`'s job.
 * @param version - exact runner release version
 * @param options - command options
 * @param options.user - pin this person's config rather than this repository's
 * @returns completion of pin publication
 */
export async function pin(version: string, options: { user?: boolean }): Promise<void> {
    const user = options.user === true
    const root = scopeRoot(user)

    if (!existsSync(join(root, CONFIG_FILE))) {
        throw new Error(
            user
                ? `No personal config in ${root}; set it up with ft init --user`
                : `No ${CONFIG_FILE} in ${root}; set this repository up with ft init`,
        )
    }

    const release = await fetchRelease(
        version,
        existsSync(join(root, LAUNCHER_FILE)) ? ['launcher'] : [],
    )

    await writeRelease(root, release)
    process.stderr.write(`Pinned ft ${version} in ${join(root, LOCK_FILE)}\n`)
}
