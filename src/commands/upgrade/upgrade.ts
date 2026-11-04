import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { scopeRoot } from '../../project/config/config'
import { CONFIG_FILE, NPM_PACKAGE } from '../../project/config/constants'
import { installedLauncher } from '../../project/config/launcher'
import {
    fetchInstaller,
    fetchRelease,
    latestVersion,
    writeRelease,
} from '../../project/config/release'

/**
 * Bring this machine to the newest release by running that release's own installer, so there is
 * one install path: it replaces the launcher where it already is, caches the new runner and moves
 * the personal pin. Repositories keep their pins; moving one is a change to commit, made with
 * `ft pin`. An npm install has no installer to rerun: its launcher updates through npm, so
 * upgrading moves only the personal pin.
 * @returns completion
 */
export async function upgrade(): Promise<void> {
    if (process.env.FT_NPM_PACKAGE) {
        const root = scopeRoot(true)

        if (!existsSync(join(root, CONFIG_FILE))) {
            throw new Error(`no ${CONFIG_FILE} in ${root} (set it up with ft init --user)`)
        }

        const version = await latestVersion()

        await writeRelease(root, await fetchRelease(version, false))
        process.stdout.write(
            `Pinned ft ${version} for your personal setup. To update the launcher itself, update ${NPM_PACKAGE} with npm or bun\n`,
        )

        return
    }

    const version = await latestVersion()
    const [installer, launcher] = await Promise.all([fetchInstaller(version), installedLauncher()])
    /* The installer runs from its verified text; it never reads files beside itself. */
    const child = Bun.spawn(['sh', '-c', installer, 'install.sh', version], {
        stdio: ['inherit', 'inherit', 'inherit'],
        env: { ...process.env, ...(launcher ? { FT_INSTALL_DIR: dirname(launcher) } : {}) },
    })
    const code = await child.exited

    if (code !== 0) {
        throw new Error(`ft ${version} installer failed (exit ${code}; see its output above)`)
    }
}
