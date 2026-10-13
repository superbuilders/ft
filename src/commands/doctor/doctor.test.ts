import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, expect, it, vi } from 'vitest'

import { doctor } from './doctor'

afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
})

/**
 * Run doctor against one config and capture what it prints.
 * @param config - the .ft.json contents
 * @returns the exit code and the printed text
 */
async function diagnose(config: object): Promise<{ code: number; output: string }> {
    const root = await mkdtemp(join(tmpdir(), 'ft-doctor-'))
    const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true)

    try {
        await writeFile(join(root, '.ft.json'), JSON.stringify(config))
        vi.stubEnv('FT_CONFIG', join(root, '.ft.json'))

        const code = await doctor('0.1.0')

        return { code, output: stdout.mock.calls.map(([text]) => String(text)).join('') }
    } finally {
        await rm(root, { recursive: true, force: true })
    }
}

it('fails a config with no lanes', async () => {
    const { code, output } = await diagnose({ providers: {}, lanes: {} })

    expect(code).toBe(2)
    expect(output).toContain('Lanes: none yet; add one named code')
    expect(output).toContain('Not ready: 1 problem above')
})

it('fails a key it cannot load, without exposing anything', async () => {
    vi.stubEnv('FT_DOCTOR_TEST_KEY', '')

    const { code, output } = await diagnose({
        providers: { anthropic: { key: { env: 'FT_DOCTOR_TEST_KEY' } } },
        lanes: { code: { model: 'anthropic/claude-opus-5-5' } },
    })

    expect(code).toBe(2)
    expect(output).toContain('Provider anthropic: key failed')
    expect(output).toMatch(/Not ready: 1 problem above\n$/)
})

it('is ready when every check passes', async () => {
    vi.stubEnv('FT_DOCTOR_TEST_KEY', 'test-key')

    const { code, output } = await diagnose({
        providers: { anthropic: { key: { env: 'FT_DOCTOR_TEST_KEY' } } },
        lanes: { code: { model: 'anthropic/claude-opus-5-5' } },
    })

    expect(code).toBe(0)
    expect(output).toContain('Provider anthropic: key loaded')
    expect(output).toMatch(/Ready\n$/)
})
