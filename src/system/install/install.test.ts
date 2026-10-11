import { existsSync } from 'node:fs'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, it, vi } from 'vitest'

import { installArchive } from './install'

it('checksum mismatch leaves no final target or lock and cleans staging', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ft-install-'))

    vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response('corrupt archive')),
    )

    try {
        const finalPath = join(root, 'pi', 'test')

        await expect(
            installArchive(root, {
                name: 'pi-test',
                finalPath,
                url: 'https://not-requested.test',
                sha256: 'a'.repeat(64),
                binary: 'pi',
                version: 'test',
            }),
        ).rejects.toThrow('SHA-256 mismatch')
        expect(existsSync(finalPath)).toBe(false)
        expect(existsSync(join(root, 'locks', 'pi-test.lock'))).toBe(false)
        expect(await readdir(join(root, 'staging'))).toEqual([])
    } finally {
        vi.unstubAllGlobals()
        await rm(root, { recursive: true, force: true })
    }
})
