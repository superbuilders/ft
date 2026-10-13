import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { scopeRoot } from '../../project/config/config'
import { CONFIG_FILE, LAUNCHER_FILE, LOCK_FILE } from '../../project/config/constants'
import { fetchRelease, latestVersion, writeRelease } from '../../project/config/release'
import { tildePath } from '../../system/host/host'
import { styleFor } from '../../system/terminal/style'
import { renderSummary } from '../../system/terminal/summary'

/**
 * Pin a release for one scope: write its checksums to the lock and its config schema beside it,
 * and update the repository launcher when there is one. All come from the pinned release, so they
 * always match the runner the launcher will start. A scope that is not set up is refused, since
 * setting one up is `ft init`'s job.
 * @param requested - exact runner release version; the newest release when omitted
 * @param options - command options
 * @param options.user - pin this person's config rather than this repository's
 * @returns completion of pin publication
 */
export async function pin(
    requested: string | undefined,
    options: { user?: boolean },
): Promise<void> {
    const user = options.user === true
    const root = scopeRoot(user)

    if (!existsSync(join(root, CONFIG_FILE))) {
        let hint = '; set this repository up with ft init'

        if (user) {
            hint = '; set it up with ft init --user'
        } else if (existsSync(join(scopeRoot(true), CONFIG_FILE))) {
            /* ft runs on the personal config here, so a bare pin most likely meant that one. */
            hint = `; this directory uses your personal config, so pin that with ft pin --user${requested ? ` ${requested}` : ''}, or set this repository up with ft init`
        }

        throw new Error(`No ${CONFIG_FILE} in ${root}${hint}`)
    }

    const version = requested ?? (await latestVersion())
    const release = await fetchRelease(version, existsSync(join(root, LAUNCHER_FILE)))

    await writeRelease(root, release)
    process.stdout.write(
        renderSummary(
            {
                done: `Pinned ft ${version} for ${user ? 'your personal setup' : 'this repository'}`,
                rows: [['Lock', tildePath(join(root, LOCK_FILE))]],
            },
            styleFor(process.stdout),
        ),
    )
}
