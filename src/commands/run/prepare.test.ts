import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { RUN_FILES } from '../../project/runs/constants'
import { prepare } from './prepare'

import type { RunOptions } from './types'

let root = ''

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ft-prepare-'))
    vi.stubEnv('FT_CONFIG', join(root, '.ft.json'))
    vi.stubEnv('GATEWAY_KEY', 'test-key')
    await writeFile(join(root, 'a.md'), 'A brief')
    await writeFile(
        join(root, '.ft.json'),
        JSON.stringify({
            providers: {
                gateway: {
                    key: { env: 'GATEWAY_KEY' },
                    baseUrl: 'https://gateway.test/v1',
                    api: 'openai-completions',
                    models: [{ id: 'model-a' }],
                },
            },
            roles: { code: { model: 'gateway/model-a', maxTurns: 5 } },
        }),
    )
})

afterEach(async () => {
    vi.unstubAllEnvs()
    await rm(root, { recursive: true, force: true })
})

it.each<[string, RunOptions, number | undefined]>([
    ['takes the role limit', {}, 5],
    ['lets --max-turns override the role limit', { maxTurns: '2' }, 2],
    ['gives a run on --model no role limit', { model: 'gateway/model-a' }, undefined],
])('%s', async (_name, options, maxTurns) => {
    const [status] = await prepare([join(root, 'a.md')], { workdir: root, ...options })
    const request = JSON.parse(await readFile(join(status.dir, RUN_FILES.request), 'utf8'))

    expect(request.maxTurns).toBe(maxTurns)
})
