import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { findConfig } from '../../project/config/config'
import { CONFIG_FILE, LOCK_FILE } from '../../project/config/constants'
import { atomicWrite } from '../../system/files/atomic-write'
import { TARGETS } from '../../system/host/constants'
import { commandOutput } from '../../system/process/subprocess'

import type { Lock } from '../../project/config/types'

/**
 * Fetch a private release manifest through authenticated gh and write it to the project's lock.
 * A project with no config also gets an empty one to fill in.
 * @param version - exact runner release version
 * @returns completion of pin publication
 */
export async function pin(version: string): Promise<void> {
    if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version)) {
        throw new Error('Expected a release version such as 0.1.0')
    }

    const sums = await commandOutput([
        'gh',
        'release',
        'download',
        `v${version}`,
        '-R',
        'superbuilders/ft',
        '-p',
        'SHA256SUMS',
        '-O',
        '-',
    ])
    const sha256 = {} as Lock['sha256']

    for (const target of TARGETS) {
        const matches = sums
            .split('\n')
            .map(line => /^([a-fA-F0-9]{64})  (\S+)\r?$/.exec(line))
            .filter(match => match?.[2] === `ft-${target}`)

        if (matches.length !== 1) {
            throw new Error(`Release manifest requires exactly one ft-${target} checksum`)
        }

        sha256[target] = matches[0]?.[1]?.toLowerCase() as string
    }

    const found = findConfig(process.cwd(), process.env.FT_CONFIG)
    const root = found ? dirname(found) : process.cwd()
    const lock: Lock = { version, sha256 }

    await atomicWrite(join(root, LOCK_FILE), `${JSON.stringify(lock, null, 4)}\n`)

    if (!existsSync(join(root, CONFIG_FILE))) {
        await atomicWrite(
            join(root, CONFIG_FILE),
            `${JSON.stringify({ providers: {}, lanes: {} }, null, 4)}\n`,
        )
    }

    process.stderr.write(
        `Pinned ft ${version} in ${join(root, LOCK_FILE)}${found ? '' : `; add a provider and a code lane to ${CONFIG_FILE}`}\n`,
    )
}
