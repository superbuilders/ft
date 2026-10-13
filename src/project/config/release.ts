import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { chmod, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
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
import { RELEASE_NOT_FOUND } from './patterns'

import type { Lock, Release } from './types'

/**
 * Read release files from one folder: the one the installer has just downloaded the release into
 * (`FT_RELEASE_DIR`), so setup right after an install fetches nothing twice, or else a temporary
 * folder that one authenticated gh download fills. Either way the caller checks each file against
 * the release manifest.
 * @param version - exact runner release version
 * @param assets - release asset names
 * @returns each asset's text, in order
 */
async function releaseFiles(version: string, assets: string[]): Promise<string[]> {
    /**
     * Read the assets out of one folder.
     * @param folder - folder holding the downloaded assets
     * @returns each asset's text, in order
     */
    function read(folder: string): Promise<string[]> {
        return Promise.all(assets.map(asset => readFile(join(folder, asset), 'utf8')))
    }

    const downloaded = process.env.FT_RELEASE_DIR

    if (downloaded) {
        return read(downloaded)
    }

    const folder = await mkdtemp(join(tmpdir(), 'ft-release-'))

    try {
        await commandOutput([
            'gh',
            'release',
            'download',
            `v${version}`,
            '-R',
            RELEASE_REPOSITORY,
            ...assets.flatMap(asset => ['-p', asset]),
            '-D',
            folder,
        ]).catch((error: unknown) => {
            if (error instanceof Error && RELEASE_NOT_FOUND.test(error.message)) {
                throw new Error(
                    `ft ${version} is not a published release; leave the version out for the newest`,
                    { cause: error },
                )
            }

            throw error
        })

        return await read(folder)
    } finally {
        await rm(folder, { recursive: true, force: true })
    }
}

/**
 * Refuse anything that is not a release version, before it reaches gh.
 * @param version - candidate version
 * @returns the version
 */
function checkedVersion(version: string): string {
    if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version)) {
        throw new Error('Expected a release version such as 0.2.0')
    }

    return version
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
 * Check one release file against the release manifest.
 * @param sums - SHA256SUMS text
 * @param asset - release asset name
 * @param text - the file's text
 * @returns the text, once it matches
 */
function verified(sums: string, asset: string, text: string): string {
    if (createHash('sha256').update(text).digest('hex') !== checksum(sums, asset)) {
        throw new Error(`${asset} does not match its checksum`)
    }

    return text
}

/**
 * Fetch what a caller needs from one release, each file checked against the release manifest:
 * always the runner checksums for the lock and the config schema, plus the launcher when asked for.
 * @param version - exact runner release version
 * @param withLauncher - also fetch the launcher, for a repository
 * @returns the release's files
 */
export async function fetchRelease(version: string, withLauncher: boolean): Promise<Release> {
    checkedVersion(version)

    const { schema, launcher } = RELEASE_ASSETS
    const [sums = '', schemaText = '', launcherText] = await releaseFiles(version, [
        'SHA256SUMS',
        schema,
        ...(withLauncher ? [launcher] : []),
    ])
    const sha256 = Object.fromEntries(
        TARGETS.map(target => [target, checksum(sums, `ft-${target}`)]),
    ) as Lock['sha256']

    return {
        lock: { version, sha256 },
        schema: verified(sums, schema, schemaText),
        ...(launcherText === undefined ? {} : { launcher: verified(sums, launcher, launcherText) }),
    }
}

/**
 * The newest published release.
 * @returns its version, such as 0.2.0
 */
export async function latestVersion(): Promise<string> {
    const tag = await commandOutput([
        'gh',
        'release',
        'view',
        '-R',
        RELEASE_REPOSITORY,
        '--json',
        'tagName',
        '-q',
        '.tagName',
    ])

    return checkedVersion(tag.trim().replace(/^v/, ''))
}

/**
 * Fetch one release's installer, checked against the release manifest.
 * @param version - exact runner release version
 * @returns the installer script
 */
export async function fetchInstaller(version: string): Promise<string> {
    const [sums = '', installer = ''] = await releaseFiles(checkedVersion(version), [
        'SHA256SUMS',
        RELEASE_ASSETS.installer,
    ])

    return verified(sums, RELEASE_ASSETS.installer, installer)
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
