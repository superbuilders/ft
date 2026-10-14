import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, expect, it } from 'vitest'

import { repositoryRoot } from './repository-root'

const directories: string[] = []

afterEach(async () => {
    await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

it('returns null outside a repository', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ft-repository-'))

    directories.push(root)
    expect(repositoryRoot(root)).toBeNull()
})

it('finds the nearest .git directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ft-repository-'))
    const nested = join(root, 'nested')

    directories.push(root)
    await mkdir(join(root, '.git'))
    await mkdir(join(nested, '.git'), { recursive: true })
    await mkdir(join(nested, 'child'))
    expect(repositoryRoot(join(nested, 'child'))).toBe(nested)
})

it('recognizes the .git file of a worktree or submodule', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ft-repository-'))

    directories.push(root)
    await mkdir(join(root, 'child'))
    await writeFile(join(root, '.git'), 'gitdir: /elsewhere/.git/worktrees/root\n')
    expect(repositoryRoot(join(root, 'child'))).toBe(root)
})
