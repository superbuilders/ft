import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { releaseServer } from '../../../shim/tests/fakes/release-server'
import { TARGETS } from '../../system/host/constants'
import { upgrade } from './upgrade'

import type { ReleaseServer } from '../../../shim/tests/fakes/release-server'

let root: string
let server: ReleaseServer | undefined

/**
 * Publish, as the newest release on a local release server, an installer that records how it
 * was run.
 * @param listed - the checksum SHA256SUMS lists for it, by default its real one
 * @returns completion
 */
async function release(listed?: string): Promise<void> {
    const installer = `printf '%s %s\\n' "$1" "\${FT_INSTALL_DIR:-}" >"${join(root, 'ran')}"\n`
    const sum = listed ?? createHash('sha256').update(installer).digest('hex')

    await mkdir(join(root, 'release'))
    await writeFile(join(root, 'release/install.sh'), installer)
    await writeFile(join(root, 'release/SHA256SUMS'), `${sum}  install.sh\n`)
    server = await releaseServer({ fixtures: join(root, 'release'), version: '0.3.0' })
    vi.stubEnv('FT_RELEASE_URL', server.url)
}

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ft-upgrade-'))
})

afterEach(async () => {
    await server?.close()
    server = undefined
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
})

it('refuses an installer that does not match the release manifest', async () => {
    await release('f'.repeat(64))
    await expect(upgrade()).rejects.toThrow('install.sh does not match its checksum')
})

it('moves only the personal pin for an npm install, and runs no installer', async () => {
    const schema = '{}\n'
    const personal = join(root, 'config', 'ft')
    const sums = TARGETS.map((target, index) => `${String(index).repeat(64)}  ft-${target}`)

    await release()
    await writeFile(
        join(root, 'release/SHA256SUMS'),
        [...sums, `${createHash('sha256').update(schema).digest('hex')}  schema.json`, ''].join(
            '\n',
        ),
    )
    await writeFile(join(root, 'release/schema.json'), schema)
    await mkdir(personal, { recursive: true })
    await writeFile(join(personal, '.ft.json'), '{"providers":{},"roles":{}}\n')
    vi.stubEnv('XDG_CONFIG_HOME', join(root, 'config'))
    vi.stubEnv('FT_NPM_PACKAGE', join(root, 'package'))
    vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    await upgrade()

    expect(JSON.parse(await readFile(join(personal, '.ft/lock.json'), 'utf8'))).toMatchObject({
        version: '0.3.0',
    })
    expect(existsSync(join(root, 'ran'))).toBe(false)
})
