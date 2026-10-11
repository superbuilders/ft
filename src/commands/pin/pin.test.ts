import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { TARGETS } from '../../system/host/constants'
import { pin } from './pin'

const SCHEMA = '{"title":".ft.json"}\n'
const assets: Record<string, string> = {}
let root: string

vi.mock('../../system/process/subprocess', () => ({
    commandOutput: async (argv: string[]) => {
        const asset = assets[argv[argv.indexOf('-p') + 1] ?? '']

        if (asset === undefined) {
            throw new Error('gh failed')
        }

        return asset
    },
}))

/**
 * Serve one release's SHA256SUMS and schema.json in place of gh.
 * @param schemaDigest - the digest the manifest lists for schema.json
 */
function release(schemaDigest: string): void {
    assets.SHA256SUMS = `${[
        ...TARGETS.map((target, index) => `${String(index).repeat(64)}  ft-${target}`),
        `${schemaDigest}  schema.json`,
    ].join('\n')}\n`
    assets['schema.json'] = SCHEMA
}

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ft-pin-'))
    vi.spyOn(process, 'cwd').mockReturnValue(root)
    vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    vi.stubEnv('FT_CONFIG', '')
})

afterEach(async () => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    await rm(root, { recursive: true, force: true })
})

it("writes the release's checksums, its checked schema, and a starter config", async () => {
    release(createHash('sha256').update(SCHEMA).digest('hex'))
    await pin('0.2.0')

    const lock = JSON.parse(await readFile(join(root, '.ft.lock'), 'utf8'))

    expect(lock.version).toBe('0.2.0')
    expect(lock.sha256['darwin-arm64']).toBe('0'.repeat(64))
    expect(await readFile(join(root, '.ft.schema.json'), 'utf8')).toBe(SCHEMA)
    expect(JSON.parse(await readFile(join(root, '.ft.json'), 'utf8'))).toEqual({
        $schema: './.ft.schema.json',
        providers: {},
        lanes: {},
    })
})

it('refuses a schema that does not match the release manifest', async () => {
    release('f'.repeat(64))
    await expect(pin('0.2.0')).rejects.toThrow('does not match its checksum')
})
