import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, it, vi } from 'vitest'

import { run } from './run'

it('refuses a run it cannot start before creating anything, and clears a stale --out', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ft-run-'))
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)

    vi.stubEnv('FT_CONFIG', join(root, 'missing.ft.json'))

    try {
        const out = join(root, 'answer.txt')

        await writeFile(out, 'an answer from an earlier run')
        expect(await run({ brief: join(root, 'brief.md'), out })).toBe(2)
        expect(stderr).toHaveBeenCalledWith(
            expect.stringContaining('could not start the run (configuration_error)'),
        )
        expect(existsSync(out)).toBe(false)
        expect(existsSync(join(root, '.ft'))).toBe(false)
    } finally {
        stderr.mockRestore()
        vi.unstubAllEnvs()
        await rm(root, { recursive: true, force: true })
    }
})

it('prints the refusal as JSON when asked', async () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true)

    vi.stubEnv('FT_CONFIG', join(tmpdir(), 'ft-missing', '.ft.json'))

    try {
        expect(await run({ brief: 'brief.md', json: true })).toBe(2)

        const printed = JSON.parse(String(stdout.mock.calls[0]?.[0])) as {
            outcome: string
            error: string
        }

        expect(printed.outcome).toBe('configuration_error')
        expect(printed.error).toContain('ENOENT')
    } finally {
        stdout.mockRestore()
        vi.unstubAllEnvs()
    }
})
