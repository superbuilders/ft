import { existsSync } from 'node:fs'
import { mkdir, readFile, realpath, symlink, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'

import { findConfig, isPersonal, repositoryRoot } from '../../project/config/config'
import { CONFIG_FILE, LAUNCHER_FILE, SKILL_PATH } from '../../project/config/constants'
import { fetchRelease, writeRelease, writeStarterConfig } from '../../project/config/release'
import { atomicWrite } from '../../system/files/atomic-write'
import { configRoot, homeDirectory } from '../../system/host/host'
import { LOCKFILES, PACKAGE_SCRIPT } from './constants'

/**
 * Put the agent skill under a base directory, and link it where Claude Code looks.
 * @param base - repository or home directory
 * @param text - the release's skill
 * @param linkClaude - also link `.claude/skills/ft` (unless `.claude/skills` already is `.agents/skills`)
 * @returns paths written, relative to base
 */
async function placeSkill(base: string, text: string, linkClaude: boolean): Promise<string[]> {
    const written: string[] = []
    const skill = join(base, SKILL_PATH)

    if (!existsSync(skill)) {
        await atomicWrite(skill, text)
        written.push(SKILL_PATH)
    }

    const claudeSkills = join(base, '.claude', 'skills')
    const shared = existsSync(claudeSkills)
        ? (await realpath(claudeSkills)) === (await realpath(dirname(dirname(skill))))
        : false
    const link = join(claudeSkills, 'ft')

    if (linkClaude && !shared && !existsSync(link)) {
        await mkdir(claudeSkills, { recursive: true })
        await symlink(relative(claudeSkills, dirname(skill)), link)
        written.push(relative(base, link))
    }

    return written
}

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
        manager === 'npm' ? `npm run ${PACKAGE_SCRIPT.name}` : `${manager} ${PACKAGE_SCRIPT.name}`
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
 * Describe what happened to the config.
 * @param written - whether a config was written
 * @param from - the config it copied, if any
 * @returns one clause
 */
function configNote(written: boolean, from: string | undefined): string {
    if (!written) {
        return `${CONFIG_FILE} (kept as it was)`
    }

    return from
        ? `${CONFIG_FILE} (copied from ${from})`
        : `${CONFIG_FILE} (empty: add a provider and a lane named code)`
}

/**
 * Set ft up, from one release. For a repository: its lock, schema and launcher, a config, the
 * agent skill and a package script, so everyone who clones it can use ft with only gh installed.
 * With `user`: the same config and skill in the personal config directory and home, so ft works
 * in any repository that has not set it up.
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
    const release = await fetchRelease(version)

    if (options.user) {
        const root = configRoot()

        await writeRelease(root, release, false)

        const written = await writeStarterConfig(root, options.from)
        const skill = await placeSkill(
            homeDirectory(),
            release.skill,
            existsSync(join(homeDirectory(), '.claude')),
        )

        process.stdout.write(
            [
                `Set up ft ${version} for you in ${root}: ${configNote(written, options.from)}, .ft/lock.json, .ft/schema.json`,
                ...skill.map(path => `Wrote ~/${path}`),
                'ft now works in any repository without its own .ft.json. Next:',
                `  1. ${written && !options.from ? `Add a provider and a lane named code to ${join(root, CONFIG_FILE)}, then run` : 'Run'} ft doctor to check it`,
                '  2. Let Claude Code run ft without asking: allow Bash(ft:*) in ~/.claude/settings.json',
            ]
                .map(line => `${line}\n`)
                .join(''),
        )

        return
    }

    const found = findConfig(process.cwd(), process.env.FT_CONFIG)
    const root = found && !isPersonal(found) ? dirname(found) : repositoryRoot(process.cwd())

    await writeRelease(root, release, true)

    const written = await writeStarterConfig(root, options.from)
    const skill = await placeSkill(root, release.skill, true)
    const script = await packageScript(root)

    process.stdout.write(
        [
            `Set up ft ${version} in ${root}: ${configNote(written, options.from)}, .ft/lock.json, .ft/schema.json, ${LAUNCHER_FILE}`,
            ...[
                ...skill,
                ...(script.added ? [`package.json script ${PACKAGE_SCRIPT.name}`] : []),
            ].map(path => `Wrote ${path}`),
            `Agents here run ft as ${script.command}. Next:`,
            `  1. ${written && !options.from ? `Add a provider and a lane named code to ${CONFIG_FILE}, then run` : 'Run'} ${script.command} doctor to check it`,
            `  2. Let Claude Code run it without asking: allow Bash(${script.command}:*) in .claude/settings.json`,
            '  3. Commit these files. Anyone who clones the repository needs only gh, signed in',
        ]
            .map(line => `${line}\n`)
            .join(''),
    )
}
