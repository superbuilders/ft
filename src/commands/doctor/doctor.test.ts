import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, expect, it, vi } from 'vitest'

import { doctor } from './doctor'

afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
})

/**
 * Run doctor against one repository config and capture what it prints.
 * @param config - the .ft.json contents
 * @param options - how doctor runs
 * @param options.personal - also write this as the personal config
 * @param options.user - run doctor --user
 * @returns the exit code and the printed text
 */
async function diagnose(
    config: object,
    options: { personal?: object; user?: boolean } = {},
): Promise<{ code: number; output: string }> {
    const root = await mkdtemp(join(tmpdir(), 'ft-doctor-'))
    const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true)

    try {
        await writeFile(join(root, '.ft.json'), JSON.stringify(config))
        vi.stubEnv('FT_CONFIG', join(root, '.ft.json'))

        if (options.personal) {
            await mkdir(join(root, 'xdg/ft'), { recursive: true })
            await writeFile(join(root, 'xdg/ft/.ft.json'), JSON.stringify(options.personal))
            vi.stubEnv('XDG_CONFIG_HOME', join(root, 'xdg'))
        }

        const code = await doctor('0.1.0', { user: options.user })

        return { code, output: stdout.mock.calls.map(([text]) => String(text)).join('') }
    } finally {
        await rm(root, { recursive: true, force: true })
    }
}

it('fails a config with no roles', async () => {
    const { code, output } = await diagnose({ providers: {}, roles: {} })

    expect(code).toBe(2)
    expect(output).toContain('  none yet; add one named code')
    expect(output).toContain('Not ready: 1 problem above')
})

it('fails a key it cannot load, without exposing anything', async () => {
    vi.stubEnv('FT_DOCTOR_TEST_KEY', '')

    const { code, output } = await diagnose({
        providers: { anthropic: { key: { env: 'FT_DOCTOR_TEST_KEY' } } },
        roles: { code: { model: 'anthropic/claude-opus-5-5' } },
    })

    expect(code).toBe(2)
    expect(output).toMatch(/  anthropic +Pi's built-in endpoint +key failed/)
    expect(output).toMatch(/Not ready: 1 problem above\n$/)
})

it('is ready when every check passes', async () => {
    vi.stubEnv('FT_DOCTOR_TEST_KEY', 'test-key')

    const { code, output } = await diagnose({
        providers: { anthropic: { key: { env: 'FT_DOCTOR_TEST_KEY' } } },
        roles: { code: { model: 'anthropic/claude-opus-5-5' } },
    })

    expect(code).toBe(0)
    expect(output).toMatch(/  anthropic +Pi's built-in endpoint +key loaded/)
    expect(output).toMatch(/Ready\n$/)
})

it('says the personal config is not used where a repository config replaces it', async () => {
    const { output } = await diagnose(
        { providers: {}, roles: {} },
        { personal: { providers: {}, roles: {} } },
    )

    expect(output).toMatch(/\(your personal config, .*xdg\/ft\/\.ft\.json, is not used here\)/)
})

it('checks the personal config with --user, even where a repository config applies', async () => {
    vi.stubEnv('FT_DOCTOR_TEST_KEY', 'test-key')

    const { code, output } = await diagnose(
        { providers: {}, roles: {} },
        {
            personal: {
                providers: { anthropic: { key: { env: 'FT_DOCTOR_TEST_KEY' } } },
                roles: { code: { model: 'anthropic/claude-opus-5-5' } },
            },
            user: true,
        },
    )

    expect(code).toBe(0)
    expect(output).toMatch(/^Config +.*xdg\/ft\/\.ft\.json \(personal\)\n/)
    expect(output).not.toContain('Project')
})
