import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { fetchInstaller, latestVersion } from '../../project/config/release'
import { installedLauncher } from '../../system/host/host'

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
    const folder = await mkdtemp(join(tmpdir(), 'ft-upgrade-'))

    try {
        await writeFile(join(folder, 'install.sh'), installer)

        const child = Bun.spawn(['sh', join(folder, 'install.sh'), version], {
            stdio: ['inherit', 'inherit', 'inherit'],
            env: { ...process.env, ...(launcher ? { FT_INSTALL_DIR: dirname(launcher) } : {}) },
        })
        const code = await child.exited

        if (code !== 0) {
            throw new Error(
                `The ft ${version} installer failed (exit ${code}); see its output above`,
            )
        }
    } finally {
        await rm(folder, { recursive: true, force: true })
    }

    process.stdout.write(
        `Repositories keep the version they pinned; run ft pin inside one to move it to ${version}\n`,
    )
}
