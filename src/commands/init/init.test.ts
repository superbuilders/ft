import { createHash } from 'node:crypto'
import { existsSync, lstatSync, statSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readlink, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { TARGETS } from '../../system/host/constants'
import { init } from './init'

const SHIM = '#!/bin/sh\necho shim\n'
const SKILL = '# ft skill\n'
const SCHEMA = '{"title":".ft.json"}\n'
const assets: Record<string, string> = {}
let root: string
let output: string

vi.mock('../../system/process/subprocess', () => ({
    commandOutput: async (argv: string[]) => {
        const asset = assets[argv[argv.indexOf('-p') + 1] ?? '']

        if (asset === undefined) {
            throw new Error('gh failed')
        }

        return asset
    },
}))

/**
 * Hash text the way a release manifest does.
 * @param text - asset contents
 * @returns hex SHA-256
 */
function sha(text: string): string {
    return createHash('sha256').update(text).digest('hex')
}

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ft-init-'))
    output = ''
    Object.assign(assets, {
        'schema.json': SCHEMA,
        'ft-shim': SHIM,
        'SKILL.md': SKILL,
        SHA256SUMS: `${[
            ...TARGETS.map((target, index) => `${String(index).repeat(64)}  ft-${target}`),
            `${sha(SCHEMA)}  schema.json`,
            `${sha(SHIM)}  ft-shim`,
            `${sha(SKILL)}  SKILL.md`,
        ].join('\n')}\n`,
    })
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

it('sets a repository up so a clone needs only gh', async () => {
    const repo = join(root, 'repo')

    await writeFile(join(repo, 'package.json'), '{\n  "name": "app"\n}\n')
    await writeFile(join(repo, 'bun.lock'), '')
    await init('0.2.0', {})

    expect(JSON.parse(await readFile(join(repo, '.ft/lock.json'), 'utf8')).version).toBe('0.2.0')
    expect(await readFile(join(repo, '.ft/ft'), 'utf8')).toBe(SHIM)
    expect(statSync(join(repo, '.ft/ft')).mode & 0o111).not.toBe(0)
    expect(JSON.parse(await readFile(join(repo, '.ft.json'), 'utf8')).providers).toEqual({})
    expect(await readFile(join(repo, '.agents/skills/ft/SKILL.md'), 'utf8')).toBe(SKILL)
    expect(await readlink(join(repo, '.claude/skills/ft'))).toBe('../../.agents/skills/ft')
    expect(await readFile(join(repo, 'package.json'), 'utf8')).toBe(
        '{\n  "name": "app",\n  "scripts": {\n    "ft": "sh .ft/ft"\n  }\n}\n',
    )
    expect(output).toContain('Agents here run ft as bun ft')
})

it('adds no Claude link where .claude/skills already is .agents/skills', async () => {
    const repo = join(root, 'repo')

    await mkdir(join(repo, '.agents/skills'), { recursive: true })
    await mkdir(join(repo, '.claude'))
    await symlink('../.agents/skills', join(repo, '.claude/skills'))
    await init('0.2.0', {})

    expect(lstatSync(join(repo, '.claude/skills')).isSymbolicLink()).toBe(true)
    expect(existsSync(join(repo, '.agents/skills/ft/SKILL.md'))).toBe(true)
    expect(output).not.toContain('Wrote .claude')
    expect(output).toContain('Agents here run ft as .ft/ft')
})

it('sets ft up for one person, copying a shared config', async () => {
    const shared = join(root, 'shared.json')

    await writeFile(shared, JSON.stringify({ providers: {}, lanes: {} }))
    await mkdir(join(root, 'home', '.claude'), { recursive: true })
    await init('0.2.0', { user: true, from: shared })

    expect(existsSync(join(root, 'config/ft/.ft/lock.json'))).toBe(true)
    expect(existsSync(join(root, 'config/ft/.ft/ft'))).toBe(false)
    expect(JSON.parse(await readFile(join(root, 'config/ft/.ft.json'), 'utf8')).$schema).toBe(
        './.ft/schema.json',
    )
    expect(await readFile(join(root, 'home/.agents/skills/ft/SKILL.md'), 'utf8')).toBe(SKILL)
    expect(existsSync(join(root, 'home/.claude/skills/ft'))).toBe(true)
    expect(existsSync(join(root, 'repo/.ft'))).toBe(false)
})
