import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readlink, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { skill } from './skill'

const SKILL = '# ft skill\n'
let root: string
let output: string

vi.mock('./text', () => ({ SKILL_TEXT: '# ft skill\n' }))

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ft-skill-'))
    output = ''
    await mkdir(join(root, 'repo', '.git'), { recursive: true })
    vi.spyOn(process, 'cwd').mockReturnValue(join(root, 'repo'))
    vi.spyOn(process.stdout, 'write').mockImplementation(chunk => {
        output += String(chunk)

        return true
    })
    vi.stubEnv('FT_CONFIG', '')
    vi.stubEnv('HOME', join(root, 'home'))
    vi.stubEnv('XDG_CONFIG_HOME', join(root, 'config'))
})

afterEach(async () => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    await rm(root, { recursive: true, force: true })
})

it('puts the skill in the repository and links it for Claude Code', async () => {
    const repo = join(root, 'repo')

    await skill({})

    expect(await readFile(join(repo, '.agents/skills/ft/SKILL.md'), 'utf8')).toBe(SKILL)
    expect(await readlink(join(repo, '.claude/skills/ft'))).toBe('../../.agents/skills/ft')
    expect(output).toContain('Skill  .agents/skills/ft/SKILL.md (written, linked for Claude Code)')
    expect(existsSync(join(root, 'home'))).toBe(false)
})

it('adds no Claude link where .claude/skills already is .agents/skills', async () => {
    const repo = join(root, 'repo')

    await mkdir(join(repo, '.agents/skills'), { recursive: true })
    await mkdir(join(repo, '.claude'))
    await symlink('../.agents/skills', join(repo, '.claude/skills'))
    await skill({})

    expect(await readlink(join(repo, '.claude/skills'))).toBe('../.agents/skills')
    expect(existsSync(join(repo, '.agents/skills/ft/SKILL.md'))).toBe(true)
})

it('brings a stale skill up to date, and says when nothing changed', async () => {
    const path = join(root, 'repo/.agents/skills/ft/SKILL.md')

    await mkdir(join(root, 'repo/.agents/skills/ft'), { recursive: true })
    await writeFile(path, '# old\n')
    await skill({})
    expect(await readFile(path, 'utf8')).toBe(SKILL)
    expect(output).toContain('(updated,')

    output = ''
    await skill({})
    expect(output).toContain('(already up to date,')
})

it('puts the skill in your home with --user, linking it only when Claude Code is there', async () => {
    await skill({ user: true })

    expect(await readFile(join(root, 'home/.agents/skills/ft/SKILL.md'), 'utf8')).toBe(SKILL)
    expect(existsSync(join(root, 'home/.claude'))).toBe(false)
    expect(existsSync(join(root, 'repo/.agents'))).toBe(false)
    expect(output).toContain('Skill  ~/.agents/skills/ft/SKILL.md (written)')
})
