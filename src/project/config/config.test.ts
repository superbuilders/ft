import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { resolveLane } from '../../models/models'
import { TARGETS } from '../../system/host/constants'
import { findConfig, loadConfig, validateConfig } from './config'

const directories: string[] = []
const valid = {
    version: '0.1.0',
    sha256: Object.fromEntries(TARGETS.map(target => [target, 'a'.repeat(64)])),
    apiKey: { env: 'TEST_KEY' },
}

afterEach(async () => {
    vi.unstubAllEnvs()
    await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('config', () => {
    it('discovers nearest config and honors FT_CONFIG', async () => {
        const root = await mkdtemp(join(tmpdir(), 'ft-config-'))

        directories.push(root)

        const nested = join(root, 'child', 'leaf')

        await mkdir(nested, { recursive: true })
        await writeFile(join(root, '.ft.json'), JSON.stringify(valid))
        await writeFile(join(root, 'child', '.ft.json'), JSON.stringify(valid))
        expect(findConfig(nested)).toBe(join(root, 'child', '.ft.json'))
        vi.stubEnv('FT_CONFIG', join(root, '.ft.json'))

        const config = await loadConfig(nested)

        expect(config.root).toBe(root)
    })

    it.each([
        { ...valid, version: '../bad' },
        { ...valid, sha256: {} },
        { ...valid, apiKey: { command: [] } },
        { ...valid, apiKey: { command: ['echo'], env: 'TEST_KEY' } },
        { ...valid, apiKey: { env: 'not a name' } },
        { ...valid, gateway: { baseUrl: 'https://key@example.test' } },
        { ...valid, lanes: { code: { model: 'fuzzy' } } },
        { ...valid, lanes: { code: { model: 'gpt-6.1-sol', thinking: 'invalid' } } },
    ])('rejects invalid schema %#', value => {
        expect(() => validateConfig(value)).toThrow()
    })

    it('resolves defaults and full lane overrides, never fuzzy models', async () => {
        const root = await mkdtemp(join(tmpdir(), 'ft-lanes-'))

        directories.push(root)
        await writeFile(
            join(root, '.ft.json'),
            JSON.stringify({ ...valid, lanes: { code: { model: 'grok-latest' } } }),
        )
        vi.stubEnv('FT_CONFIG', join(root, '.ft.json'))

        const config = await loadConfig(root)

        expect(resolveLane(config.lanes, 'code')).toEqual({ model: 'grok-latest' })
        expect(resolveLane(config.lanes)).toEqual({ model: 'grok-latest' })
        expect(resolveLane(config.lanes, 'research')).toEqual({ model: 'sonar-pro' })
        expect(resolveLane(config.lanes, undefined, 'gpt-6.1-sol', 'high')).toEqual({
            model: 'gpt-6.1-sol',
            thinking: 'high',
        })
        expect(() => resolveLane(config.lanes, 'missing')).toThrow()
    })
})
