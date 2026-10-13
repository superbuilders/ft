import { existsSync } from 'node:fs'
import { mkdir, readFile, realpath, symlink } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'

import { scopeRoot } from '../../project/config/config'
import { SKILL_PATH } from '../../project/config/constants'
import { atomicWrite } from '../../system/files/atomic-write'
import { homeDirectory } from '../../system/host/host'
import { styleFor } from '../../system/terminal/style'
import { renderSummary } from '../../system/terminal/summary'
import { SKILL_TEXT } from './text'

import type { SkillPlacement } from './types'

/**
 * Decide where the skill goes: this repository, or this person's home.
 * @param user - the personal scope rather than the repository
 * @returns the base directory and whether to link it for Claude Code
 */
function placement(user: boolean): SkillPlacement {
    if (user) {
        return { base: homeDirectory(), linkClaude: existsSync(join(homeDirectory(), '.claude')) }
    }

    return { base: scopeRoot(false), linkClaude: true }
}

/**
 * Link the skill where Claude Code looks, unless `.claude/skills` already is `.agents/skills`.
 * @param base - repository or home directory
 * @returns completion
 */
async function linkForClaude(base: string): Promise<void> {
    const skills = join(base, '.claude', 'skills')
    const link = join(skills, 'ft')
    const target = dirname(join(base, SKILL_PATH))

    if (existsSync(skills) && (await realpath(skills)) === (await realpath(dirname(target)))) {
        return
    }

    if (!existsSync(link)) {
        await mkdir(skills, { recursive: true })
        await symlink(relative(skills, target), link)
    }
}

/**
 * Write the agent skill that teaches agents to delegate through ft, from the copy built into this
 * runner, so running it again after an upgrade brings the skill up to date.
 * @param options - command options
 * @param options.user - put it in this person's home, for every repository, not this one
 * @returns completion
 */
export async function skill(options: { user?: boolean }): Promise<void> {
    const { base, linkClaude } = placement(options.user === true)
    const path = join(base, SKILL_PATH)
    const before = existsSync(path) ? await readFile(path, 'utf8') : null

    if (before !== SKILL_TEXT) {
        await atomicWrite(path, SKILL_TEXT)
    }

    if (linkClaude) {
        await linkForClaude(base)
    }

    const shown = options.user ? `~/${SKILL_PATH}` : SKILL_PATH
    let state = 'updated'

    if (before === null) {
        state = 'written'
    } else if (before === SKILL_TEXT) {
        state = 'already up to date'
    }

    const notes = [state, linkClaude ? 'linked for Claude Code' : null].filter(Boolean).join(', ')

    process.stdout.write(
        renderSummary(
            {
                done: `Installed the ft skill ${options.user ? 'for every repository' : 'in this repository'}`,
                rows: [['Skill', `${shown} (${notes})`]],
                notes: [
                    options.user
                        ? 'To let agents run ft without asking each time, allow ft commands in their settings'
                        : 'Commit it, so agents in every clone use ft',
                ],
            },
            styleFor(process.stdout),
        ),
    )
}
