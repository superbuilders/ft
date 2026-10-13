import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, expect, it, vi } from 'vitest'

import { roles } from './roles'

afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
})

/**
 * Run ft roles against one config and capture what it prints.
 * @param config - the .ft.json contents
 * @param options - command options
 * @param options.json - print JSON
 * @returns the printed text
 */
async function listRoles(config: object, options: { json?: boolean } = {}): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'ft-roles-'))
    const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true)

    try {
        await writeFile(join(root, '.ft.json'), JSON.stringify(config))
        vi.stubEnv('FT_CONFIG', join(root, '.ft.json'))
        await roles(options)

        return stdout.mock.calls.map(([text]) => String(text)).join('')
    } finally {
        await rm(root, { recursive: true, force: true })
    }
}

const CONFIG = {
    providers: { anthropic: { key: { env: 'ANTHROPIC_API_KEY' } } },
    roles: {
        code: { model: 'anthropic/claude-opus-5-5', thinking: 'high' },
        research: { model: 'anthropic/claude-sonnet-5-5', description: 'Look things up.' },
    },
}

it('lines up each role with its model, marking the default', async () => {
    expect(await listRoles(CONFIG)).toBe(
        [
            'code (default)  anthropic/claude-opus-5-5, thinking high',
            'research        anthropic/claude-sonnet-5-5  Look things up.',
            '',
        ].join('\n'),
    )
})

it('prints one JSON object per role', async () => {
    const output = await listRoles(CONFIG, { json: true })
    const lines = output
        .trim()
        .split('\n')
        .map(line => JSON.parse(line))

    expect(lines).toEqual([
        { name: 'code', default: true, model: 'anthropic/claude-opus-5-5', thinking: 'high' },
        {
            name: 'research',
            default: false,
            model: 'anthropic/claude-sonnet-5-5',
            description: 'Look things up.',
        },
    ])
})

it('refuses a config with no roles, naming the one to add', async () => {
    await expect(listRoles({ providers: {}, roles: {} })).rejects.toThrow(
        /^no roles in .+ yet \(add one named code\)$/,
    )
})
