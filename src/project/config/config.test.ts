import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { EXAMPLE_CONFIG } from '../../models/constants'
import { resolveRole } from '../../models/models'
import {
    findConfig,
    loadConfig,
    resolveBaseUrl,
    runsFolder,
    scopeRoot,
    validateConfig,
} from './config'

const directories: string[] = []
const gateway = {
    key: { env: 'GATEWAY_KEY' },
    baseUrl: 'https://gateway.test/v1',
    api: 'openai-completions' as const,
    compat: { supportsDeveloperRole: false },
    models: [
        { id: 'model-a', reasoning: true },
        { id: 'search', adapter: 'sonar' },
    ],
}
const valid = {
    providers: { gateway, groq: { key: { command: ['pass', 'groq'] } } },
    roles: {
        code: { model: 'gateway/model-a', thinking: 'high' },
        fast: { model: 'groq/llama-3.1-8b-instant' },
    },
}

afterEach(async () => {
    vi.unstubAllEnvs()
    await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('config', () => {
    it('discovers nearest config and honors FT_CONFIG', async () => {
        const root = await mkdtemp(join(tmpdir(), 'ft-config-'))
        const nested = join(root, 'child', 'grandchild')

        directories.push(root)
        await mkdir(nested, { recursive: true })
        await writeFile(join(root, '.ft.json'), JSON.stringify(valid))
        await writeFile(join(root, 'child', '.ft.json'), JSON.stringify(valid))
        expect(findConfig(nested)).toBe(join(root, 'child', '.ft.json'))
        vi.stubEnv('FT_CONFIG', join(root, '.ft.json'))

        const loaded = await loadConfig(nested)

        expect(loaded.root).toBe(root)
        expect(loaded.runs).toBe(join(root, '.ft', 'runs'))
    })

    it('falls back to the personal config, keeping runs for the repository around cwd in the state folder', async () => {
        const root = await mkdtemp(join(tmpdir(), 'ft-config-'))
        const nested = join(root, 'repo', 'src')

        directories.push(root)
        await mkdir(join(root, 'config', 'ft'), { recursive: true })
        await mkdir(join(root, 'repo', '.git'), { recursive: true })
        await mkdir(nested)
        await writeFile(join(root, 'config', 'ft', '.ft.json'), JSON.stringify(valid))
        vi.stubEnv('XDG_CONFIG_HOME', join(root, 'config'))
        vi.stubEnv('XDG_STATE_HOME', join(root, 'state'))

        const loaded = await loadConfig(nested)

        expect(loaded.path).toBe(join(root, 'config', 'ft', '.ft.json'))
        expect(loaded.root).toBe(join(root, 'config', 'ft'))
        expect(loaded.workspace).toBe(join(root, 'repo'))
        expect(loaded.runs).toBe(
            join(root, 'state', 'ft', 'runs', join(root, 'repo').slice(1).replaceAll('/', '-')),
        )
    })

    it('puts runs in runs.dir: relative from the workspace, absolute as is', async () => {
        const root = await mkdtemp(join(tmpdir(), 'ft-config-'))

        /**
         * Write a project config with this runs.dir and load it.
         * @param dir - the runs.dir to set
         * @returns the runs folder the config resolves to
         */
        async function runsFor(dir: string): Promise<string> {
            await writeFile(join(root, '.ft.json'), JSON.stringify({ ...valid, runs: { dir } }))

            const loaded = await loadConfig(root)

            return loaded.runs
        }

        directories.push(root)
        vi.stubEnv('HOME', join(root, 'home'))
        expect(await runsFor('/var/ft')).toBe('/var/ft')
        expect(await runsFor('~/ft-runs')).toBe(join(root, 'home', 'ft-runs'))
        expect(await runsFor('tmp/runs')).toBe(join(root, 'tmp', 'runs'))
        vi.stubEnv('FT_CONFIG', join(root, '.ft.json'))
        expect(runsFolder()).toBe(join(root, 'tmp', 'runs'))
    })

    it('keeps one folder per repository in an absolute runs.dir of the personal config', async () => {
        const root = await mkdtemp(join(tmpdir(), 'ft-config-'))

        directories.push(root)
        await mkdir(join(root, 'config', 'ft'), { recursive: true })
        await mkdir(join(root, 'repo', '.git'), { recursive: true })
        await writeFile(
            join(root, 'config', 'ft', '.ft.json'),
            JSON.stringify({ ...valid, runs: { dir: join(root, 'runs') } }),
        )
        vi.stubEnv('XDG_CONFIG_HOME', join(root, 'config'))

        const loaded = await loadConfig(join(root, 'repo'))

        expect(loaded.runs).toBe(
            join(root, 'runs', join(root, 'repo').slice(1).replaceAll('/', '-')),
        )
    })

    it('has a repository scope only inside a git repository or a project config', async () => {
        const root = await mkdtemp(join(tmpdir(), 'ft-config-'))

        directories.push(root)
        await mkdir(join(root, 'repo', '.git'), { recursive: true })
        await mkdir(join(root, 'repo', 'src'))
        await mkdir(join(root, 'project'))
        await writeFile(join(root, 'project', '.ft.json'), JSON.stringify(valid))
        vi.stubEnv('FT_CONFIG', '')
        vi.stubEnv('XDG_CONFIG_HOME', join(root, 'config'))

        const cwd = vi.spyOn(process, 'cwd')

        cwd.mockReturnValue(join(root, 'repo', 'src'))
        expect(scopeRoot(false)).toBe(join(root, 'repo'))
        cwd.mockReturnValue(join(root, 'project'))
        expect(scopeRoot(false)).toBe(join(root, 'project'))
        cwd.mockReturnValue(root)
        expect(() => scopeRoot(false)).toThrow(
            'not a git repository (use --user for your personal setup)',
        )
        expect(scopeRoot(true)).toBe(join(root, 'config', 'ft'))
        cwd.mockRestore()
    })

    it('accepts built-in and custom providers, Pi fields, $schema and an env base URL', () => {
        expect(validateConfig(valid)).toEqual(valid)

        const envUrl = {
            ...valid,
            $schema: './.ft/schema.json',
            providers: { gateway: { ...gateway, baseUrl: { env: 'GATEWAY_URL' } } },
            roles: { code: valid.roles.code },
        }

        expect(validateConfig(envUrl)).toEqual(envUrl)
    })

    it('accepts the example ft shows when no roles are configured, and resolves its default role', () => {
        const example = validateConfig(JSON.parse(EXAMPLE_CONFIG))

        expect(example.providers).toEqual({
            anthropic: { key: { env: 'ANTHROPIC_API_KEY' } },
        })
        expect(Object.keys(example.roles)).toEqual(['code'])
        expect(resolveRole(example.providers, example.roles)).toMatchObject({
            provider: 'anthropic',
        })
    })

    it('reads an env base URL at use time and checks it', () => {
        const provider = { ...gateway, baseUrl: { env: 'TEST_GATEWAY_URL' } }

        expect(() => resolveBaseUrl('gateway', provider)).toThrow(
            'TEST_GATEWAY_URL is empty or unset',
        )
        // secretlint-disable-next-line @secretlint/secretlint-rule-basicauth -- a fake credential the code must reject
        vi.stubEnv('TEST_GATEWAY_URL', 'https://user:pass@gateway.test/v1')
        expect(() => resolveBaseUrl('gateway', provider)).toThrow('without credentials')
        vi.stubEnv('TEST_GATEWAY_URL', 'https://gateway.test/v1')
        expect(resolveBaseUrl('gateway', provider)).toBe('https://gateway.test/v1')
        expect(resolveBaseUrl('groq', valid.providers.groq)).toBeUndefined()
    })

    it.each([
        [{ ...valid, version: '0.1.0' }, 'belong in .ft/lock.json now'],
        [{ ...valid, extra: true }, 'extra: not a field ft or Pi reads'],
        [{ providers: valid.providers }, 'roles'],
        [{ ...valid, providers: { gateway: { ...gateway, key: { command: [] } } } }, 'key'],
        [{ ...valid, providers: { gateway: { ...gateway, key: { env: 'not a name' } } } }, 'key'],
        [{ ...valid, providers: { gateway: { ...gateway, apiKey: 'sk-raw' } } }, 'gateway.apiKey'],
        [
            { ...valid, providers: { gateway: { ...gateway, api: 'carrier-pigeon' } } },
            'gateway.api',
        ],
        [
            { ...valid, providers: { gateway: { ...gateway, baseUrl: 'https://u:p@x.test' } } },
            'baseUrl',
        ],
        [{ ...valid, providers: { gateway: { key: gateway.key } } }, 'gateway.baseUrl: required'],
        [
            {
                ...valid,
                providers: {
                    ...valid.providers,
                    groq: { ...valid.providers.groq, models: [{ id: 'x', adapter: 'sonar' }] },
                },
            },
            'groq.baseUrl: required, because model x uses an adapter',
        ],
        [
            {
                ...valid,
                providers: { gateway: { ...gateway, models: [{ id: 'a' }, { id: 'a' }] } },
            },
            'more than once',
        ],
        [
            {
                ...valid,
                providers: {
                    gateway: { ...gateway, models: [{ id: 'model-a', compactAt: 8000 }] },
                },
            },
            'compactAt',
        ],
        [{ ...valid, roles: { code: { model: 'model-a' } } }, 'provider/model'],
        [{ ...valid, roles: { code: { model: 'gateway/missing' } } }, 'has no model missing'],
        [
            { ...valid, roles: { code: { model: 'gateway/model-a', thinking: 'huge' } } },
            'roles.code.thinking',
        ],
    ])('rejects invalid config %#', (config, message) => {
        expect(() => validateConfig(config)).toThrow(message)
    })
})
