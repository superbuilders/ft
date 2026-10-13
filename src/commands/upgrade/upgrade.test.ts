import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { upgrade } from './upgrade'

const assets: Record<string, string> = {}
let root: string
let output: string

vi.mock('../../system/process/subprocess', () => ({
    /**
     * Act as gh: the newest tag for release view, else every -p asset into the -D folder.
     * @param argv - the gh command line
     * @returns gh's stdout
     */
    commandOutput: async (argv: string[]) => {
        if (argv.includes('view')) {
            return 'v0.3.0\n'
        }

        const { writeFile: write } = await import('node:fs/promises')
        const folder = argv[argv.indexOf('-D') + 1] ?? ''
        const names = argv.flatMap((arg, index) => (arg === '-p' ? [argv[index + 1] ?? ''] : []))

        await Promise.all(names.map(name => write(join(folder, name), assets[name] ?? '')))

        return ''
    },
}))

/**
 * Publish an installer that records how it was run.
 * @param listed - the checksum SHA256SUMS lists for it, by default its real one
 */
function release(listed?: string): void {
    const installer = `printf '%s %s\\n' "$1" "\${FT_INSTALL_DIR:-}" >"${join(root, 'ran')}"\n`

    assets['install.sh'] = installer
    assets.SHA256SUMS = `${listed ?? createHash('sha256').update(installer).digest('hex')}  install.sh\n`
}

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ft-upgrade-'))
    output = ''
    vi.spyOn(process.stdout, 'write').mockImplementation(chunk => {
        output += String(chunk)

        return true
    })
    vi.stubEnv('FT_RELEASE_DIR', '')
})

afterEach(async () => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    await rm(root, { recursive: true, force: true })
})

it('runs the newest release installer where the launcher already is, and leaves repositories', async () => {
    const bin = join(root, 'bin')

    await mkdir(bin)
    await writeFile(join(bin, 'ft'), '#!/bin/sh\nSHIM_VERSION=0.1.0\n')
    vi.stubEnv('PATH', `${bin}:${process.env.PATH ?? ''}`)
    release()
    await upgrade()

    expect(await readFile(join(root, 'ran'), 'utf8')).toBe(`0.3.0 ${bin}\n`)
    expect(output).toContain('run ft pin inside one to move it to 0.3.0')
})

it('refuses an installer that does not match the release manifest', async () => {
    release('f'.repeat(64))
    await expect(upgrade()).rejects.toThrow('install.sh does not match its checksum')
})
