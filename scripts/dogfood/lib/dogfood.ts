import { existsSync } from 'node:fs'
import { chmod, copyFile, mkdir, mkdtemp, readFile, rename, rm, symlink } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import { commandOutput } from '../../../src/system/process/subprocess'
import { DOGFOOD_TAG, INSTALL_PATH } from './constants'

/**
 * Build ft from the last commit, ignoring uncommitted edits, and install it as `ft-dev` beside the
 * installed `ft`. Agents working in this repository delegate through it, so a half-finished change
 * never breaks the tool reviewing it; it also tries a change in other repositories before release.
 * @returns completion
 */
export async function dogfood(): Promise<void> {
    const [head, changes] = await Promise.all([
        commandOutput(['git', 'rev-parse', '--short=12', 'HEAD']),
        commandOutput(['git', 'status', '--porcelain']),
    ])
    const commit = head.trim()
    const dirty = changes.trim() !== ''
    const { version } = JSON.parse(await readFile('package.json', 'utf8')) as { version: string }
    const build = `${version}-${DOGFOOD_TAG}.${commit}`
    const stage = await mkdtemp(join(tmpdir(), 'ft-dogfood-'))
    const target = join(homedir(), ...INSTALL_PATH)

    try {
        const archive = join(stage, 'head.tar')
        const output = join(stage, 'ft')

        await commandOutput(['git', 'archive', '--format=tar', '-o', archive, 'HEAD'])
        await commandOutput(['tar', '-xf', archive, '-C', stage])
        await symlink(resolve('node_modules'), join(stage, 'node_modules'))
        await commandOutput([
            process.execPath,
            'build',
            '--compile',
            join(stage, 'src', 'cli.ts'),
            '--define',
            `FT_BUILD_VERSION=${JSON.stringify(build)}`,
            '--outfile',
            output,
        ])

        if (process.platform === 'darwin') {
            await commandOutput(['codesign', '--force', '--sign', '-', output])
        }

        await mkdir(dirname(target), { recursive: true })
        await copyFile(output, `${target}.new`)
        await chmod(`${target}.new`, 0o755)
        await rename(`${target}.new`, target)
    } finally {
        await rm(stage, { recursive: true, force: true })
    }

    process.stdout.write(
        `Installed ft ${build} at ${target}${dirty ? ' (uncommitted edits are not in it; commit and rerun to include them)' : ''}\n`,
    )
}

/**
 * Remove the dogfood build, leaving the installed `ft` alone.
 * @returns completion
 */
export async function removeDogfood(): Promise<void> {
    const target = join(homedir(), ...INSTALL_PATH)

    if (!existsSync(target)) {
        process.stdout.write(`Nothing to remove at ${target}\n`)

        return
    }

    await rm(target)
    process.stdout.write(`Removed ${target}\n`)
}
