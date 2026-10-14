import { describe, expect, it } from 'vitest'

import { builtinContextWindow } from './catalog'
import { compactionReserve, findModel, resolveRole } from './models'

import type { Provider } from './types'

const providers: Record<string, Provider> = {
    gateway: {
        key: { env: 'GATEWAY_KEY' },
        baseUrl: 'https://gateway.test/v1',
        api: 'openai-completions',
        models: [{ id: 'org/model-a' }, { id: 'search', adapter: 'sonar' }],
    },
    groq: { key: { env: 'GROQ_KEY' } },
}

describe('findModel', () => {
    it('splits on the first slash, so model ids may contain slashes', () => {
        expect(findModel(providers, 'gateway/org/model-a')).toEqual({
            provider: 'gateway',
            model: 'org/model-a',
            entry: { id: 'org/model-a' },
        })
    })

    it("finds a built-in provider's models in Pi's catalog", () => {
        expect(findModel(providers, 'groq/llama-3.1-8b-instant')).toEqual({
            provider: 'groq',
            model: 'llama-3.1-8b-instant',
        })
    })

    it.each(['model-a', '/model-a', 'gateway/', 'missing/model-a', 'gateway/nope', 'groq/nope'])(
        'rejects %s',
        ref => {
            expect(() => findModel(providers, ref)).toThrow()
        },
    )
})

describe('compactionReserve', () => {
    const custom: Provider = { key: { env: 'KEY' }, api: 'openai-completions' }

    it('turns the 400000-token default into the reserve Pi takes: the window minus it', () => {
        const selected = { provider: 'p', model: 'm', entry: { id: 'm', contextWindow: 1_050_000 } }

        expect(compactionReserve(selected, custom)).toBe(650_000)
    })

    it("uses the entry's compactAt", () => {
        const selected = {
            provider: 'p',
            model: 'm',
            entry: { id: 'm', contextWindow: 1_000_000, compactAt: 250_000 },
        }

        expect(compactionReserve(selected, custom)).toBe(750_000)
    })

    it('never compacts later than Pi would on a window smaller than the compaction point', () => {
        const selected = { provider: 'p', model: 'm', entry: { id: 'm', contextWindow: 200_000 } }

        expect(compactionReserve(selected, custom)).toBe(16_384)
    })

    it("finds the window in the provider's overrides, then Pi's catalog, then Pi's default", () => {
        const window = builtinContextWindow('groq', 'llama-3.1-8b-instant') ?? 0

        expect(
            compactionReserve(
                { provider: 'p', model: 'm' },
                { ...custom, modelOverrides: { m: { contextWindow: 900_000 } } },
            ),
        ).toBe(500_000)
        expect(compactionReserve({ provider: 'groq', model: 'llama-3.1-8b-instant' }, custom)).toBe(
            Math.max(16_384, window - 400_000),
        )
        expect(window).toBeGreaterThan(0)
        expect(compactionReserve({ provider: 'p', model: 'm' }, custom)).toBe(16_384)
    })
})

describe('resolveRole', () => {
    const roles = { code: { model: 'gateway/org/model-a', thinking: 'high' as const } }

    it('uses the code role by default and lets --thinking override it', () => {
        expect(resolveRole(providers, roles)).toMatchObject({
            model: 'org/model-a',
            thinking: 'high',
        })
        expect(resolveRole(providers, roles, 'code', undefined, 'off')).toMatchObject({
            thinking: 'off',
        })
    })

    it('takes an explicit model instead of a role', () => {
        expect(resolveRole(providers, roles, undefined, 'gateway/search')).toEqual({
            provider: 'gateway',
            model: 'search',
            entry: { id: 'search', adapter: 'sonar' },
        })
    })

    it('rejects unknown roles and thinking levels', () => {
        expect(() => resolveRole(providers, roles, 'missing')).toThrow('no role named missing')
        expect(() => resolveRole(providers, roles, 'code', undefined, 'huge')).toThrow()
    })
})
