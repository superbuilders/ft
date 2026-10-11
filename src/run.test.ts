import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, it, vi } from 'vitest'

import { run } from './run'

import type { Status } from './types'

it('writes configuration-error status and sidecars without overwriting an existing answer', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ft-status-'))
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)

    vi.stubEnv('FT_CONFIG', join(root, 'missing.ft.json'))

    try {
        const out = join(root, 'answer.txt')

        await writeFile(out, 'prior successful answer')
        expect(await run({ brief: join(root, 'brief.md'), out })).toBe(2)

        const status = JSON.parse(await readFile(`${out}.status.json`, 'utf8')) as Status

        expect(status.schemaVersion).toBe(1)
        expect(status.outcome).toBe('configuration_error')
        expect(status.piExitCode).toBeNull()
        expect(status.model).toBeNull()
        expect(status.durationMs).toBeGreaterThanOrEqual(0)
        expect(await readFile(out, 'utf8')).toBe('prior successful answer')
        expect(await readFile(`${out}.events.jsonl`, 'utf8')).toBe('')
        expect(await readFile(`${out}.stderr.log`, 'utf8')).toContain('ENOENT')
    } finally {
        stderr.mockRestore()
        vi.unstubAllEnvs()
        await rm(root, { recursive: true, force: true })
    }
})
