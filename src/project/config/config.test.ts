import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { findConfig, loadConfig, validateConfig } from './config'

const directories: string[] = []
const gateway = {
    key: { env: 'GATEWAY_KEY' },
    baseUrl: 'https://gateway.test/v1',
    api: 'openai-completions',
    compat: { supportsDeveloperRole: false },
    models: [
        { id: 'model-a', reasoning: true },
        { id: 'search', adapter: 'sonar' },
    ],
}
const valid = {
    providers: { gateway, groq: { key: { command: ['pass', 'groq'] } } },
    lanes: {
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
    })

    it('accepts built-in and custom providers, passing unknown Pi fields through', () => {
        expect(validateConfig(valid)).toEqual(valid)
    })

    it.each([
        [{ ...valid, version: '0.1.0' }, 'now live in .ft.lock'],
        [{ ...valid, extra: true }, 'root'],
        [{ providers: valid.providers }, 'lanes'],
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
        [{ ...valid, lanes: { code: { model: 'model-a' } } }, 'provider/model'],
        [{ ...valid, lanes: { code: { model: 'gateway/missing' } } }, 'has no model missing'],
        [
            { ...valid, lanes: { code: { model: 'gateway/model-a', thinking: 'huge' } } },
            'lanes.code.thinking',
        ],
    ])('rejects invalid config %#', (config, message) => {
        expect(() => validateConfig(config)).toThrow(message)
    })
})
