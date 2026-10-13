import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { doctor } from './doctor'

/** Stands in for the provider's model list, so the key check never leaves the machine. */
const providerAnswers = vi.fn(async () => new Response('{}', { status: 200 }))

beforeEach(() => {
    vi.stubGlobal('fetch', providerAnswers)
})

afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
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
    expect(output).toMatch(/  anthropic +Pi's built-in endpoint +key accepted/)
    expect(output).toMatch(/Ready\n$/)
    expect(providerAnswers).toHaveBeenCalledWith(
        'https://api.anthropic.com/v1/models',
        expect.objectContaining({ headers: expect.objectContaining({ 'x-api-key': 'test-key' }) }),
    )
})

it('fails a key the provider rejects, naming the field to fix', async () => {
    vi.stubEnv('FT_DOCTOR_TEST_KEY', 'test-key')
    providerAnswers.mockResolvedValueOnce(new Response('{}', { status: 401 }))

    const { code, output } = await diagnose({
        providers: { anthropic: { key: { env: 'FT_DOCTOR_TEST_KEY' } } },
        roles: { code: { model: 'anthropic/claude-opus-5-5' } },
    })

    expect(code).toBe(2)
    expect(output).toMatch(
        /the provider rejected the key \(HTTP 401; check providers\.anthropic\.key in .*\.ft\.json\)/,
    )
    expect(output).not.toContain('test-key')
})

it('does not fail a key whose check could not run', async () => {
    vi.stubEnv('FT_DOCTOR_TEST_KEY', 'test-key')
    providerAnswers.mockRejectedValueOnce(new Error('offline'))

    const { code, output } = await diagnose({
        providers: { anthropic: { key: { env: 'FT_DOCTOR_TEST_KEY' } } },
        roles: { code: { model: 'anthropic/claude-opus-5-5' } },
    })

    expect(code).toBe(0)
    expect(output).toContain('key loaded (not checked: the provider did not answer)')
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
