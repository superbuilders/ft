import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, it } from 'vitest'

import { prepareAgent } from './agent'

it("writes only the run's provider, with ft's key command, without ft-only fields, and the compaction reserve", async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ft-agent-'))

    try {
        const { agent } = await prepareAgent(
            dir,
            {
                id: 'gateway',
                provider: {
                    key: { env: 'GATEWAY_KEY' },
                    baseUrl: { env: 'GATEWAY_URL' },
                    api: 'openai-completions',
                    models: [{ id: 'search', adapter: 'sonar', compactAt: 1000, maxTokens: 8192 }],
                },
                baseUrl: 'http://127.0.0.1:1234',
            },
            'context',
            650_000,
        )
        const models = JSON.parse(await readFile(join(agent, 'models.json'), 'utf8'))

        expect(models).toEqual({
            providers: {
                gateway: {
                    api: 'openai-completions',
                    baseUrl: 'http://127.0.0.1:1234',
                    apiKey: expect.stringMatching(/^!.* 'key' 'gateway'$/),
                    models: [{ id: 'search', maxTokens: 8192 }],
                },
            },
        })
        expect(JSON.parse(await readFile(join(agent, 'auth.json'), 'utf8'))).toEqual({})
        expect(JSON.parse(await readFile(join(agent, 'settings.json'), 'utf8')).compaction).toEqual(
            { reserveTokens: 650_000 },
        )
    } finally {
        await rm(dir, { recursive: true, force: true })
    }
})
