import { createHash } from 'node:crypto'
import { existsSync, statSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { TARGETS } from '../../system/host/constants'
import { init } from './init'

const SHIM = '#!/bin/sh\necho shim\n'
const SCHEMA = '{"title":".ft.json"}\n'
const assets: Record<string, string> = {}
let root: string
let output: string

vi.mock('../../system/process/subprocess', () => ({
    /**
     * Act as gh release download: every -p asset into the -D folder, failing on a missing one.
     * @param argv - the gh command line
     * @returns gh's empty stdout
     */
    commandOutput: async (argv: string[]) => {
        const { writeFile: write } = await import('node:fs/promises')
        const folder = argv[argv.indexOf('-D') + 1] ?? ''
        const names = argv.flatMap((arg, index) => (arg === '-p' ? [argv[index + 1] ?? ''] : []))

        if (names.some(name => assets[name] === undefined)) {
            throw new Error('gh failed')
        }

        await Promise.all(names.map(name => write(join(folder, name), assets[name] ?? '')))

        return ''
    },
}))

/**
 * Hash text the way a release manifest does.
 * @param text - asset contents
 * @returns hex SHA-256
 */
function sha(text: string): string {
    return createHash('sha256').update(text).digest('hex')
}

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ft-init-'))
    output = ''
    Object.assign(assets, {
        'schema.json': SCHEMA,
        'ft-shim': SHIM,
        SHA256SUMS: `${[
            ...TARGETS.map((target, index) => `${String(index).repeat(64)}  ft-${target}`),
            `${sha(SCHEMA)}  schema.json`,
            `${sha(SHIM)}  ft-shim`,
        ].join('\n')}\n`,
    })
    await mkdir(join(root, 'repo', '.git'), { recursive: true })
    vi.spyOn(process, 'cwd').mockReturnValue(join(root, 'repo'))
    vi.spyOn(process.stdout, 'write').mockImplementation(chunk => {
        output += String(chunk)

        return true
    })
    vi.stubEnv('FT_CONFIG', '')
    vi.stubEnv('HOME', join(root, 'home'))
    vi.stubEnv('XDG_CONFIG_HOME', join(root, 'config'))
})

afterEach(async () => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    await rm(root, { recursive: true, force: true })
})

it('sets a repository up so a clone needs only gh', async () => {
    const repo = join(root, 'repo')

    await writeFile(join(repo, 'package.json'), '{\n  "name": "app"\n}\n')
    await writeFile(join(repo, 'bun.lock'), '')
    await init('0.2.0', {})

    expect(JSON.parse(await readFile(join(repo, '.ft/lock.json'), 'utf8')).version).toBe('0.2.0')
    expect(await readFile(join(repo, '.ft/ft'), 'utf8')).toBe(SHIM)
    expect(statSync(join(repo, '.ft/ft')).mode & 0o111).not.toBe(0)
    expect(JSON.parse(await readFile(join(repo, '.ft.json'), 'utf8')).providers).toEqual({})
    expect(existsSync(join(repo, '.agents'))).toBe(false)
    expect(await readFile(join(repo, 'package.json'), 'utf8')).toBe(
        '{\n  "name": "app",\n  "scripts": {\n    "ft": "sh .ft/ft"\n  }\n}\n',
    )
    expect(output).toMatch(/Run as +bun ft \(script added to package.json\)/)
    expect(output).toContain('Optional: bun ft skill')
})

it('sets ft up for one person, copying a shared config', async () => {
    const shared = join(root, 'shared.json')

    await writeFile(shared, JSON.stringify({ providers: {}, roles: {} }))
    await init('0.2.0', { user: true, from: shared })

    expect(existsSync(join(root, 'config/ft/.ft/lock.json'))).toBe(true)
    expect(existsSync(join(root, 'config/ft/.ft/ft'))).toBe(false)
    expect(JSON.parse(await readFile(join(root, 'config/ft/.ft.json'), 'utf8')).$schema).toBe(
        './.ft/schema.json',
    )
    expect(existsSync(join(root, 'home'))).toBe(false)
    expect(output).toContain(`Config  ${join(root, 'config/ft/.ft.json')} (copied from ${shared})`)
    expect(existsSync(join(root, 'repo/.ft'))).toBe(false)
})

it('writes nothing when the config to copy cannot be read', async () => {
    await expect(init('0.2.0', { from: join(root, 'missing.json') })).rejects.toThrow('ENOENT')
    expect(existsSync(join(root, 'repo', '.ft'))).toBe(false)
})

it('spells the npm script with -- so ft keeps its own flags', async () => {
    await writeFile(join(root, 'repo', 'package.json'), '{}\n')
    await init('0.2.0', {})

    expect(output).toMatch(/Run as +npm run ft --/)
})

it('reads the release the installer downloaded instead of calling gh', async () => {
    const downloaded = join(root, 'downloaded')

    await mkdir(downloaded)
    await Promise.all(
        Object.entries(assets).map(([name, text]) => writeFile(join(downloaded, name), text)),
    )

    for (const name of Object.keys(assets)) {
        delete assets[name]
    }

    vi.stubEnv('FT_RELEASE_DIR', downloaded)
    await init('0.2.0', { user: true })

    expect(existsSync(join(root, 'config/ft/.ft/schema.json'))).toBe(true)
})
