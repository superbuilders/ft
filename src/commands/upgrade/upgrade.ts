import { dirname } from 'node:path'

import { installedLauncher } from '../../project/config/launcher'
import { fetchInstaller, latestVersion } from '../../project/config/release'

/**
 * Bring this machine to the newest release by running that release's own installer, so there is
 * one install path: it replaces the launcher where it already is, caches the new runner and moves
 * the personal pin. Repositories keep their pins; moving one is a change to commit, made with
 * `ft pin`.
 * @returns completion
 */
export async function upgrade(): Promise<void> {
    const version = await latestVersion()
    const [installer, launcher] = await Promise.all([fetchInstaller(version), installedLauncher()])
    /* The installer runs from its verified text; it never reads files beside itself. */
    const child = Bun.spawn(['sh', '-c', installer, 'install.sh', version], {
        stdio: ['inherit', 'inherit', 'inherit'],
        env: { ...process.env, ...(launcher ? { FT_INSTALL_DIR: dirname(launcher) } : {}) },
    })
    const code = await child.exited

    if (code !== 0) {
        throw new Error(`The ft ${version} installer failed (exit ${code}); see its output above`)
    }

    process.stdout.write(
        `Repositories keep the version they pinned; run ft pin inside one to move it to ${version}\n`,
    )
}
