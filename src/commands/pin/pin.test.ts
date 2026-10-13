import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { TARGETS } from '../../system/host/constants'
import { pin } from './pin'

const SCHEMA = '{"title":".ft.json"}\n'
const SHIM = '#!/bin/sh\n'
const assets: Record<string, string> = {}
let root: string

/**
 * Hash text the way a release manifest does.
 * @param text - asset contents
 * @returns hex SHA-256
 */
function sha(text: string): string {
    return createHash('sha256').update(text).digest('hex')
}

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
 * Serve one release's assets in place of gh.
 * @param schemaDigest - the digest the manifest lists for schema.json
 */
function release(schemaDigest: string): void {
    Object.assign(assets, { 'schema.json': SCHEMA, 'ft-shim': SHIM })
    assets.SHA256SUMS = `${[
        ...TARGETS.map((target, index) => `${String(index).repeat(64)}  ft-${target}`),
        `${schemaDigest}  schema.json`,
        `${sha(SHIM)}  ft-shim`,
    ].join('\n')}\n`
}

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ft-pin-'))
    vi.spyOn(process, 'cwd').mockReturnValue(root)
    vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    vi.stubEnv('FT_CONFIG', '')
    vi.stubEnv('XDG_CONFIG_HOME', join(root, 'config'))
    await mkdir(join(root, '.git'))
})

afterEach(async () => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    await rm(root, { recursive: true, force: true })
})

it("writes the release's checksums and its checked schema beside the repository's config", async () => {
    release(sha(SCHEMA))
    await writeFile(join(root, '.ft.json'), '{}\n')
    await pin('0.2.0', {})

    const lock = JSON.parse(await readFile(join(root, '.ft/lock.json'), 'utf8'))

    expect(lock.version).toBe('0.2.0')
    expect(lock.sha256['darwin-arm64']).toBe('0'.repeat(64))
    expect(await readFile(join(root, '.ft/schema.json'), 'utf8')).toBe(SCHEMA)
    expect(await readFile(join(root, '.ft.json'), 'utf8')).toBe('{}\n')
})

it('pins the personal config with --user, and leaves the repository alone', async () => {
    release(sha(SCHEMA))
    await mkdir(join(root, 'config/ft'), { recursive: true })
    await writeFile(join(root, 'config/ft/.ft.json'), '{}\n')
    await pin('0.2.0', { user: true })

    expect(existsSync(join(root, 'config/ft/.ft/lock.json'))).toBe(true)
    expect(existsSync(join(root, '.ft'))).toBe(false)
})

it.each([
    [{}, 'set this repository up with ft init'],
    [{ user: true }, 'set it up with ft init --user'],
])('refuses a scope that is not set up (%o)', async (options, message) => {
    release(sha(SCHEMA))
    await expect(pin('0.2.0', options)).rejects.toThrow(message)
    expect(existsSync(join(root, '.ft'))).toBe(false)
})

it('points a bare pin at --user where the personal config is the one in use', async () => {
    release(sha(SCHEMA))
    await mkdir(join(root, 'config/ft'), { recursive: true })
    await writeFile(join(root, 'config/ft/.ft.json'), '{}\n')
    await expect(pin('0.2.0', {})).rejects.toThrow('pin that with ft pin --user 0.2.0')
    expect(existsSync(join(root, 'config/ft/.ft'))).toBe(false)
})

it('refuses a schema that does not match the release manifest', async () => {
    release('f'.repeat(64))
    await writeFile(join(root, '.ft.json'), '{}\n')
    await expect(pin('0.2.0', {})).rejects.toThrow('schema.json does not match its checksum')
})
