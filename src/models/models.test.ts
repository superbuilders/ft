import { describe, expect, it } from 'vitest'

import { findModel, resolveLane } from './models'

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

describe('resolveLane', () => {
    const lanes = { code: { model: 'gateway/org/model-a', thinking: 'high' as const } }

    it('uses the code lane by default and lets --thinking override it', () => {
        expect(resolveLane(providers, lanes)).toMatchObject({
            model: 'org/model-a',
            thinking: 'high',
        })
        expect(resolveLane(providers, lanes, 'code', undefined, 'off')).toMatchObject({
            thinking: 'off',
        })
    })

    it('takes an explicit model instead of a lane', () => {
        expect(resolveLane(providers, lanes, undefined, 'gateway/search')).toEqual({
            provider: 'gateway',
            model: 'search',
            entry: { id: 'search', adapter: 'sonar' },
        })
    })

    it('rejects unknown lanes and thinking levels', () => {
        expect(() => resolveLane(providers, lanes, 'missing')).toThrow('no lane named missing')
        expect(() => resolveLane(providers, lanes, 'code', undefined, 'huge')).toThrow()
    })
})
