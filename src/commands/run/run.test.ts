import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, it, vi } from 'vitest'

import { run, start } from './run'

import type { RunOptions } from './types'

/**
 * Start runs in a fresh folder with one configured model, and expect ft to refuse them before
 * creating any run.
 * @param setup - writes the case's files into the folder, then names the briefs and options
 * @param error - text the refusal must contain
 * @returns nothing
 */
async function expectRefused(
    setup: (root: string) => Promise<{ briefs: string[]; options: RunOptions }>,
    error: string,
): Promise<void> {
    const root = await mkdtemp(join(tmpdir(), 'ft-start-'))
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    const config = {
        providers: {
            gateway: {
                key: { env: 'GATEWAY_KEY' },
                baseUrl: 'https://gateway.test/v1',
                api: 'openai-completions',
                models: [{ id: 'model-a' }],
            },
        },
        roles: { code: { model: 'gateway/model-a' } },
    }

    vi.stubEnv('FT_CONFIG', join(root, '.ft.json'))
    vi.stubEnv('GATEWAY_KEY', 'test-key')

    try {
        await writeFile(join(root, '.ft.json'), JSON.stringify(config))

        const { briefs, options } = await setup(root)

        expect(await start(briefs, options)).toBe(2)
        expect(stderr).toHaveBeenCalledWith(expect.stringContaining(error))
        expect(existsSync(join(root, '.ft', 'runs'))).toBe(false)
    } finally {
        stderr.mockRestore()
        vi.unstubAllEnvs()
        await rm(root, { recursive: true, force: true })
    }
}

it('refuses a run it cannot start before creating or deleting anything', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ft-run-'))
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)

    vi.stubEnv('FT_CONFIG', join(root, 'missing.ft.json'))

    try {
        const out = join(root, 'answer.txt')

        await writeFile(out, 'an answer from an earlier run')
        expect(await run(join(root, 'brief.md'), { out })).toBe(2)
        expect(stderr).toHaveBeenCalledWith(expect.stringContaining('could not start the run: '))
        expect(existsSync(out)).toBe(true)
        expect(existsSync(join(root, '.ft'))).toBe(false)
    } finally {
        stderr.mockRestore()
        vi.unstubAllEnvs()
        await rm(root, { recursive: true, force: true })
    }
})

it('prints the refusal as JSON when asked', async () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true)

    vi.stubEnv('FT_CONFIG', join(tmpdir(), 'ft-missing', '.ft.json'))

    try {
        expect(await run('brief.md', { json: true })).toBe(2)

        const printed = JSON.parse(String(stdout.mock.calls[0]?.[0])) as {
            outcome: string
            error: string
        }

        expect(printed.outcome).toBe('configuration_error')
        expect(printed.error).toContain('ENOENT')
    } finally {
        stdout.mockRestore()
        vi.unstubAllEnvs()
    }
})

it.each([
    ['--name', { name: 'review' }, '--name and --out work only with a single brief'],
    ['a missing brief', {}, 'gone.md'],
    [
        'a --workdir that is not a folder',
        { workdir: '/no/such/folder' },
        '--workdir /no/such/folder is not a folder',
    ],
])('starts no run when one of several briefs fails (%s)', async (_case, options, error) => {
    await expectRefused(async root => {
        await writeFile(join(root, 'a.md'), 'First brief')

        return {
            briefs: [join(root, 'a.md'), join(root, error === 'gone.md' ? 'gone.md' : 'a.md')],
            options,
        }
    }, error)
})

it.each([
    ['a missing file', null, 'could not be read'],
    ['a file that is not JSON', '{"type": "object",', 'is not JSON'],
    ['an array schema', '{"type": "array"}', 'top level must be "type": "object"'],
    ['a misspelt keyword', '{"type": "object", "requird": ["a"]}', 'not valid JSON Schema'],
])('starts no run for an --output-schema that is %s', async (_case, schema, error) => {
    await expectRefused(async root => {
        const file = join(root, 'schema.json')

        await writeFile(join(root, 'a.md'), 'First brief')

        if (schema !== null) {
            await writeFile(file, schema)
        }

        return { briefs: [join(root, 'a.md')], options: { outputSchema: file } }
    }, error)
})
