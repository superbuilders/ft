import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { uninstall } from './uninstall'

let root: string
let output: string

/**
 * Lay out what an install and `ft skill --user` leave behind.
 * @returns the launcher's directory
 */
async function installed(): Promise<string> {
    const bin = join(root, 'home/.local/bin')

    await mkdir(bin, { recursive: true })
    await writeFile(join(bin, 'ft'), '#!/bin/sh\nSHIM_VERSION=0.1.0\n')
    await mkdir(join(root, 'home/.cache/ft/runner/0.1.0'), { recursive: true })
    await mkdir(join(root, 'home/.config/ft'), { recursive: true })
    await writeFile(join(root, 'home/.config/ft/.ft.json'), '{}\n')
    await mkdir(join(root, 'home/.agents/skills/ft'), { recursive: true })
    await writeFile(join(root, 'home/.agents/skills/ft/SKILL.md'), '# ft\n')
    await mkdir(join(root, 'home/.claude/skills'), { recursive: true })
    await symlink('../../.agents/skills/ft', join(root, 'home/.claude/skills/ft'))

    return bin
}

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ft-uninstall-'))
    output = ''
    vi.spyOn(process.stdout, 'write').mockImplementation(chunk => {
        output += String(chunk)

        return true
    })
    vi.stubEnv('HOME', join(root, 'home'))
    vi.stubEnv('XDG_CACHE_HOME', '')
    vi.stubEnv('XDG_CONFIG_HOME', '')
})

afterEach(async () => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    await rm(root, { recursive: true, force: true })
})

it('removes the launcher, cache and personal skill, and keeps the config', async () => {
    const bin = await installed()

    vi.stubEnv('PATH', bin)
    await uninstall({})

    expect(existsSync(join(bin, 'ft'))).toBe(false)
    expect(existsSync(join(root, 'home/.cache/ft'))).toBe(false)
    expect(existsSync(join(root, 'home/.agents/skills/ft'))).toBe(false)
    expect(existsSync(join(root, 'home/.claude/skills/ft'))).toBe(false)
    expect(existsSync(join(root, 'home/.config/ft/.ft.json'))).toBe(true)
    expect(output).toContain('Removed  ~/.local/bin/ft')
    expect(output).toContain('Kept     ~/.config/ft')
})

it('removes the config too with --purge', async () => {
    vi.stubEnv('PATH', await installed())
    await uninstall({ purge: true })

    expect(existsSync(join(root, 'home/.config/ft'))).toBe(false)
    expect(output).not.toContain('Kept')
})

it('leaves another program named ft alone', async () => {
    const other = join(root, 'other')

    await mkdir(other)
    await writeFile(join(other, 'ft'), '#!/bin/sh\necho not ours\n')
    vi.stubEnv('PATH', other)
    await uninstall({})

    expect(existsSync(join(other, 'ft'))).toBe(true)
    expect(output).toContain('Nothing to remove')
})

it("skips a repository's launcher on PATH and removes the installed one", async () => {
    const bin = await installed()
    const repository = join(root, 'repo/.ft')

    await mkdir(repository, { recursive: true })
    await writeFile(join(repository, 'ft'), '#!/bin/sh\nSHIM_VERSION=0.1.0\n')
    vi.stubEnv('PATH', `${repository}:${bin}`)
    await uninstall({})

    expect(existsSync(join(repository, 'ft'))).toBe(true)
    expect(existsSync(join(bin, 'ft'))).toBe(false)
})
