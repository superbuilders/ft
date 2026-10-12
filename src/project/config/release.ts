import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { chmod, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { atomicWrite } from '../../system/files/atomic-write'
import { TARGETS } from '../../system/host/constants'
import { commandOutput } from '../../system/process/subprocess'
import { validateConfig } from './config'
import {
    CONFIG_FILE,
    LAUNCHER_FILE,
    LOCK_FILE,
    RELEASE_ASSETS,
    RELEASE_REPOSITORY,
    SCHEMA_FILE,
} from './constants'

import type { Lock, Release } from './types'

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
        RELEASE_REPOSITORY,
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

    return (matches[0]?.[1] ?? '').toLowerCase()
}

/**
 * Fetch what a project needs from one release, each file checked against the release manifest:
 * the runner checksums for the lock, the config schema, the launcher and the agent skill.
 * @param version - exact runner release version
 * @returns the release's files
 */
export async function fetchRelease(version: string): Promise<Release> {
    if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version)) {
        throw new Error('Expected a release version such as 0.2.0')
    }

    const sums = await releaseAsset(version, 'SHA256SUMS')
    const sha256 = Object.fromEntries(
        TARGETS.map(target => [target, checksum(sums, `ft-${target}`)]),
    ) as Lock['sha256']
    const [schema, launcher, skill] = (await Promise.all(
        [RELEASE_ASSETS.schema, RELEASE_ASSETS.launcher, RELEASE_ASSETS.skill].map(async asset => {
            const text = await releaseAsset(version, asset)

            if (createHash('sha256').update(text).digest('hex') !== checksum(sums, asset)) {
                throw new Error(`Release ${asset} does not match its checksum`)
            }

            return text
        }),
    )) as [string, string, string]

    return { lock: { version, sha256 }, schema, launcher, skill }
}

/**
 * Write a release's lock and schema into a config directory, and its launcher when asked.
 * @param root - directory holding `.ft.json`
 * @param release - the fetched release
 * @param withLauncher - also write the repository launcher
 * @returns completion
 */
export async function writeRelease(
    root: string,
    release: Release,
    withLauncher: boolean,
): Promise<void> {
    await Promise.all([
        atomicWrite(join(root, LOCK_FILE), `${JSON.stringify(release.lock, null, 4)}\n`),
        atomicWrite(join(root, SCHEMA_FILE), release.schema),
    ])

    if (withLauncher) {
        await atomicWrite(join(root, LAUNCHER_FILE), release.launcher)
        await chmod(join(root, LAUNCHER_FILE), 0o755)
    }
}

/**
 * Write a config to fill in, unless the directory has one: a copy of an existing config, or an
 * empty one.
 * @param root - directory to hold `.ft.json`
 * @param from - a config file to copy, such as a teammate's project's
 * @returns whether a config was written
 */
export async function writeStarterConfig(root: string, from?: string): Promise<boolean> {
    const path = join(root, CONFIG_FILE)

    if (existsSync(path)) {
        return false
    }

    const config = from
        ? { ...(JSON.parse(await readFile(from, 'utf8')) as object), $schema: `./${SCHEMA_FILE}` }
        : { $schema: `./${SCHEMA_FILE}`, providers: {}, lanes: {} }

    validateConfig(config)
    await atomicWrite(path, `${JSON.stringify(config, null, 4)}\n`)

    return true
}
