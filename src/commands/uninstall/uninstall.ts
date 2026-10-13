import { existsSync, lstatSync } from 'node:fs'
import { readlink, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

import { SKILL_PATH } from '../../project/config/constants'
import { installedLauncher } from '../../project/config/launcher'
import { cacheRoot, configRoot, homeDirectory, tildePath } from '../../system/host/host'

/**
 * Remove what the installer and `ft skill --user` put on this machine: the launcher, the cache of
 * downloaded runners and tools, and the personal skill with its Claude Code link. The personal
 * config holds what the person wrote, so it stays unless they ask for it to go. Repositories are
 * never touched.
 * @param options - command options
 * @param options.purge - also remove the personal config
 * @returns completion
 */
export async function uninstall(options: { purge?: boolean }): Promise<void> {
    const removed: string[] = []
    const launcher = await installedLauncher()
    const skill = dirname(join(homeDirectory(), SKILL_PATH))
    const link = join(homeDirectory(), '.claude', 'skills', 'ft')

    if (launcher) {
        await rm(launcher, { force: true })
        removed.push(tildePath(launcher))
    }

    for (const path of [cacheRoot(), skill, ...(options.purge ? [configRoot()] : [])]) {
        if (existsSync(path)) {
            await rm(path, { recursive: true, force: true })
            removed.push(tildePath(path))
        }
    }

    if (
        lstatSync(link, { throwIfNoEntry: false })?.isSymbolicLink() &&
        resolve(dirname(link), await readlink(link)) === skill
    ) {
        await rm(link)
        removed.push(tildePath(link))
    }

    const lines = [
        ...removed.map(path => `Removed  ${path}`),
        ...(removed.length === 0 ? ['Nothing to remove'] : []),
        ...(!options.purge && existsSync(configRoot())
            ? [`Kept     ${tildePath(configRoot())} (your config; ft uninstall --purge removes it)`]
            : []),
        'Repositories set up with ft init keep their files',
    ]

    process.stdout.write(lines.map(line => `${line}\n`).join(''))
}
