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
 * Download one asset of a release through authenticated gh, or read it from the folder the
 * installer has just downloaded the release into (`FT_RELEASE_DIR`), so setup right after an
 * install fetches nothing twice. Either way the caller checks it against the release manifest.
 * @param version - exact runner release version
 * @param asset - release asset name
 * @returns the asset's text
 */
function releaseAsset(version: string, asset: string): Promise<string> {
    const downloaded = process.env.FT_RELEASE_DIR

    if (downloaded) {
        return readFile(join(downloaded, asset), 'utf8')
    }

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
        throw new Error(`SHA256SUMS must list exactly one checksum for ${asset}`)
    }

    return (matches[0]?.[1] ?? '').toLowerCase()
}

/**
 * Fetch what a caller needs from one release, each file checked against the release manifest:
 * always the runner checksums for the lock and the config schema, plus the launcher when asked for.
 * @param version - exact runner release version
 * @param extras - the optional files to fetch
 * @returns the release's files
 */
export async function fetchRelease(
    version: string,
    extras: readonly 'launcher'[],
): Promise<Release> {
    if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version)) {
        throw new Error('Expected a release version such as 0.2.0')
    }

    const names = ['schema' as const, ...extras]
    const [sums, ...texts] = await Promise.all(
        ['SHA256SUMS', ...names.map(name => RELEASE_ASSETS[name])].map(asset =>
            releaseAsset(version, asset),
        ),
    )
    const files = Object.fromEntries(
        names.map((name, index) => {
            const asset = RELEASE_ASSETS[name]
            const text = texts[index] ?? ''

            if (createHash('sha256').update(text).digest('hex') !== checksum(sums ?? '', asset)) {
                throw new Error(`${asset} does not match its checksum`)
            }

            return [name, text]
        }),
    ) as Pick<Release, 'schema' | 'launcher'>
    const sha256 = Object.fromEntries(
        TARGETS.map(target => [target, checksum(sums ?? '', `ft-${target}`)]),
    ) as Lock['sha256']

    return { lock: { version, sha256 }, ...files }
}

/**
 * Write a release's lock and schema into a config directory, and its launcher when it has one.
 * @param root - directory holding `.ft.json`
 * @param release - the fetched release
 * @returns completion
 */
export async function writeRelease(root: string, release: Release): Promise<void> {
    await Promise.all([
        atomicWrite(join(root, LOCK_FILE), `${JSON.stringify(release.lock, null, 4)}\n`),
        atomicWrite(join(root, SCHEMA_FILE), release.schema),
    ])

    if (release.launcher !== undefined) {
        await atomicWrite(join(root, LAUNCHER_FILE), release.launcher)
        await chmod(join(root, LAUNCHER_FILE), 0o755)
    }
}

/**
 * Build the config a setup starts from, checked before anything is written: a copy of an existing
 * config, or an empty one.
 * @param from - a config file to copy, such as a teammate's project's
 * @returns the starter config
 */
export async function starterConfig(from?: string): Promise<object> {
    const config = from
        ? { ...(JSON.parse(await readFile(from, 'utf8')) as object), $schema: `./${SCHEMA_FILE}` }
        : { $schema: `./${SCHEMA_FILE}`, providers: {}, lanes: {} }

    validateConfig(config)

    return config
}

/**
 * Write a starter config, unless the directory has a config already.
 * @param root - directory to hold `.ft.json`
 * @param config - from `starterConfig`
 * @returns whether a config was written
 */
export async function writeStarterConfig(root: string, config: object): Promise<boolean> {
    const path = join(root, CONFIG_FILE)

    if (existsSync(path)) {
        return false
    }

    await atomicWrite(path, `${JSON.stringify(config, null, 4)}\n`)

    return true
}
