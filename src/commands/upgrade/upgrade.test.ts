import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { upgrade } from './upgrade'

let root: string
let output: string

vi.mock('../../system/process/subprocess', () => ({
    /**
     * Act as gh release view, the one gh call left once FT_RELEASE_DIR serves the files.
     * @returns the newest tag
     */
    commandOutput: async () => 'v0.3.0\n',
}))

/**
 * Publish an installer that records how it was run, in the folder FT_RELEASE_DIR names.
 * @param listed - the checksum SHA256SUMS lists for it, by default its real one
 * @returns completion
 */
async function release(listed?: string): Promise<void> {
    const installer = `printf '%s %s\\n' "$1" "\${FT_INSTALL_DIR:-}" >"${join(root, 'ran')}"\n`
    const sum = listed ?? createHash('sha256').update(installer).digest('hex')

    await mkdir(join(root, 'release'))
    await writeFile(join(root, 'release/install.sh'), installer)
    await writeFile(join(root, 'release/SHA256SUMS'), `${sum}  install.sh\n`)
    vi.stubEnv('FT_RELEASE_DIR', join(root, 'release'))
}

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ft-upgrade-'))
    output = ''
    vi.spyOn(process.stdout, 'write').mockImplementation(chunk => {
        output += String(chunk)

        return true
    })
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
    await release()
    await upgrade()

    expect(await readFile(join(root, 'ran'), 'utf8')).toBe(`0.3.0 ${bin}\n`)
    expect(output).toContain('run ft pin inside one to move it to 0.3.0')
})

it('refuses an installer that does not match the release manifest', async () => {
    await release('f'.repeat(64))
    await expect(upgrade()).rejects.toThrow('install.sh does not match its checksum')
})
