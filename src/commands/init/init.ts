import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { scopeRoot } from '../../project/config/config'
import { CONFIG_FILE, LAUNCHER_FILE } from '../../project/config/constants'
import {
    fetchRelease,
    starterConfig,
    writeRelease,
    writeStarterConfig,
} from '../../project/config/release'
import { tildePath } from '../../system/host/host'
import { LOCKFILES, PACKAGE_SCRIPT } from './constants'

/**
 * Give a JavaScript repository a package script for the launcher, and say how it runs.
 * @param root - repository root
 * @returns the command the repository runs ft with
 */
async function packageScript(root: string): Promise<{ command: string; added: boolean }> {
    const path = join(root, 'package.json')

    if (!existsSync(path)) {
        return { command: LAUNCHER_FILE, added: false }
    }

    const manager = LOCKFILES.find(([file]) => existsSync(join(root, file)))?.[1] ?? 'npm'
    const command =
        manager === 'npm'
            ? `npm run ${PACKAGE_SCRIPT.name} --`
            : `${manager} ${PACKAGE_SCRIPT.name}`
    const text = await readFile(path, 'utf8')
    const manifest = JSON.parse(text) as { scripts?: Record<string, string> }

    if (manifest.scripts?.[PACKAGE_SCRIPT.name]) {
        return { command, added: false }
    }

    manifest.scripts = { ...manifest.scripts, [PACKAGE_SCRIPT.name]: PACKAGE_SCRIPT.command }
    await writeFile(path, `${JSON.stringify(manifest, null, /^(\s+)"/m.exec(text)?.[1] ?? 4)}\n`)

    return { command, added: true }
}

/**
 * Lay out what a setup did as label rows, then the numbered steps left for the reader.
 * @param rows - label and value pairs
 * @param steps - what to do next, in order
 * @returns text ending in a newline
 */
function summary(rows: [string, string][], steps: string[]): string {
    const width = Math.max(...rows.map(([label]) => label.length)) + 2

    return [
        ...rows.map(([label, value]) => `${label.padEnd(width)}${value}`),
        '',
        'Next:',
        ...steps.map((step, index) => `  ${index + 1}. ${step}`),
    ]
        .map(line => `${line}\n`)
        .join('')
}

/**
 * Set ft up, from one release. For a repository: its lock, schema and launcher, a config and a
 * package script, so everyone who clones it can use ft with only gh installed. With `user`: the
 * lock, schema and config in the personal config directory, so ft works in any repository that
 * has not set it up. The agent skill is `ft skill`'s, at either scope.
 * @param version - release to pin
 * @param options - command options
 * @param options.user - set ft up for this person rather than this repository
 * @param options.from - copy this config instead of starting an empty one
 * @returns completion
 */
export async function init(
    version: string,
    options: { user?: boolean; from?: string },
): Promise<void> {
    const user = options.user === true
    const root = scopeRoot(user)
    const [starter, release] = await Promise.all([
        starterConfig(options.from),
        fetchRelease(version, user ? [] : ['launcher']),
    ])

    await writeRelease(root, release)

    const written = await writeStarterConfig(root, starter)
    let state = 'kept as it was'

    if (written) {
        state = options.from ? `copied from ${options.from}` : 'empty'
    }

    const config = user ? tildePath(join(root, CONFIG_FILE)) : CONFIG_FILE
    const fill =
        written && !options.from ? [`Add a provider and a lane named code to ${config}`] : []

    if (user) {
        process.stdout.write(
            summary(
                [['Config', `${config} (${state})`]],
                [
                    ...fill,
                    'Check it with ft doctor',
                    'Optional: ft skill --user, to teach agents in every repository how to delegate with ft',
                ],
            ),
        )

        return
    }

    const script = await packageScript(root)

    process.stdout.write(
        summary(
            [
                ['Config', `${config} (${state})`],
                ['Launcher', `${LAUNCHER_FILE}, with its lock and schema beside it`],
                [
                    'Run as',
                    `${script.command}${script.added ? ' (script added to package.json)' : ''}`,
                ],
            ],
            [
                ...fill,
                `Check it with ${script.command} doctor`,
                `Optional: ${script.command} skill, to teach agents here how to delegate with ft`,
                'Commit these files. Anyone who clones the repository then needs only gh, signed in.',
            ],
        ),
    )
}
