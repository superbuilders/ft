import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { findConfig } from '../../project/config/config'
import { CONFIG_FILE, LOCK_FILE, SCHEMA_FILE } from '../../project/config/constants'
import { atomicWrite } from '../../system/files/atomic-write'
import { TARGETS } from '../../system/host/constants'
import { commandOutput } from '../../system/process/subprocess'

import type { Lock } from '../../project/config/types'

/**
 * Download one asset of a release through authenticated gh.
 * @param version - exact runner release version
 * @param asset - release asset name
 * @returns the asset's text
 */
function releaseAsset(version: string, asset: string): Promise<string> {
    return commandOutput([
        'gh',
        'release',
        'download',
        `v${version}`,
        '-R',
        'superbuilders/ft',
        '-p',
        asset,
        '-O',
        '-',
    ])
}

/**
 * Find the one checksum a release manifest lists for an asset.
 * @param sums - SHA256SUMS text
 * @param asset - release asset name
 * @returns lowercase hex digest
 */
function checksum(sums: string, asset: string): string {
    const matches = sums
        .split('\n')
        .map(line => /^([a-fA-F0-9]{64})  (\S+)\r?$/.exec(line))
        .filter(match => match?.[2] === asset)

    if (matches.length !== 1) {
        throw new Error(`Release manifest requires exactly one ${asset} checksum`)
    }

    const digest = matches[0]?.[1] ?? ''

    return digest.toLowerCase()
}

/**
 * Pin a release: write its checksums to the project's lock and its config schema beside it.
 * Both come from the pinned release, so they always match the runner the shim will start.
 * A project with no config also gets an empty one to fill in.
 * @param version - exact runner release version
 * @returns completion of pin publication
 */
export async function pin(version: string): Promise<void> {
    if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version)) {
        throw new Error('Expected a release version such as 0.2.0')
    }

    const sums = await releaseAsset(version, 'SHA256SUMS')
    const sha256 = Object.fromEntries(
        TARGETS.map(target => [target, checksum(sums, `ft-${target}`)]),
    ) as Lock['sha256']
    const schema = await releaseAsset(version, 'schema.json')

    if (createHash('sha256').update(schema).digest('hex') !== checksum(sums, 'schema.json')) {
        throw new Error('Release schema.json does not match its checksum')
    }

    const found = findConfig(process.cwd(), process.env.FT_CONFIG)
    const root = found ? dirname(found) : process.cwd()
    const lock: Lock = { version, sha256 }

    await atomicWrite(join(root, LOCK_FILE), `${JSON.stringify(lock, null, 4)}\n`)
    await atomicWrite(join(root, SCHEMA_FILE), schema)

    if (!existsSync(join(root, CONFIG_FILE))) {
        await atomicWrite(
            join(root, CONFIG_FILE),
            `${JSON.stringify({ $schema: `./${SCHEMA_FILE}`, providers: {}, lanes: {} }, null, 4)}\n`,
        )
    }

    process.stderr.write(
        `Pinned ft ${version} in ${join(root, LOCK_FILE)}${found ? '' : `; add a provider and a code lane to ${CONFIG_FILE}`}\n`,
    )
}
