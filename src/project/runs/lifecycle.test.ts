import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, it } from 'vitest'

import { RUN_FILES } from './constants'
import { publisher } from './lifecycle'

import type { Status } from './types'

it('reports a status write that fails when flushed, and one that works after it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ft-publish-'))
    const blocked = join(root, 'file')

    await writeFile(blocked, '')

    const status = { dir: join(blocked, 'run'), startedAt: new Date().toISOString() } as Status
    const live = publisher(status)

    try {
        live.touch()
        await expect(live.flush()).rejects.toThrow()

        status.dir = root
        await live.flush()
        expect(JSON.parse(await readFile(join(root, RUN_FILES.status), 'utf8')).dir).toBe(root)
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})
