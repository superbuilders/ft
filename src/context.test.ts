import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, it } from 'vitest'

import { collectContext } from './context'
import { commandOutput } from './install'

it('collects git-root-to-cwd instructions with precedence and import-only Claude files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ft-context-'))

    try {
        const root = join(dir, 'repo')
        const cwd = join(root, 'child', 'leaf')

        await mkdir(cwd, { recursive: true })
        await commandOutput(['git', 'init', root])
        await writeFile(join(dir, 'AGENTS.md'), 'OUTSIDE_SENTINEL')
        await writeFile(join(root, 'AGENTS.md'), 'ROOT_SENTINEL')
        await writeFile(join(root, 'CLAUDE.md'), 'IGNORED_SENTINEL')
        await writeFile(join(root, 'child', 'AGENTS.override.md'), 'OVERRIDE_SENTINEL')
        await writeFile(join(root, 'child', 'AGENTS.md'), 'IGNORED_SENTINEL')
        await writeFile(join(cwd, 'CLAUDE.md'), '@rules.md')
        await writeFile(join(cwd, 'rules.md'), 'LEAF_SENTINEL')

        const text = await collectContext(root, cwd)

        expect(text).toContain('ROOT_SENTINEL')
        expect(text).toContain('OVERRIDE_SENTINEL')
        expect(text).toContain('LEAF_SENTINEL')
        expect(text).not.toContain('IGNORED_SENTINEL')
        expect(text).not.toContain('OUTSIDE_SENTINEL')
        expect(text.indexOf('ROOT_SENTINEL')).toBeLessThan(text.indexOf('LEAF_SENTINEL'))
    } finally {
        await rm(dir, { recursive: true, force: true })
    }
})

it('uses the project root outside git and rejects imports escaping that root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ft-context-'))

    try {
        await writeFile(join(root, 'CLAUDE.md'), '@../AGENTS.md')
        await expect(collectContext(root, root)).rejects.toThrow()
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})
