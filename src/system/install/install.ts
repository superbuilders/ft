import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { commandOutput } from '../process/subprocess'
import { acquireLock } from './lock'

import type { InstallSpec } from './types'

/**
 * Verify bytes before any extraction takes place.
 * @param bytes - downloaded archive
 * @param expected - trusted SHA-256
 * @returns nothing on matching bytes
 */
function verifyChecksum(bytes: Uint8Array, expected: string): void {
    const digest = createHash('sha256').update(bytes).digest('hex')

    if (digest !== expected.toLowerCase()) {
        throw new Error(`SHA-256 mismatch: expected ${expected}, got ${digest}`)
    }
}

/**
 * Install an archive exactly once and publish only after verification and smoke testing.
 * @param root - shared cache root
 * @param spec - pinned download and destination
 * @param signal - cancellation spanning lock, download and extraction
 * @returns final executable path
 */
export async function installArchive(
    root: string,
    spec: InstallSpec,
    signal?: AbortSignal,
): Promise<string> {
    const binary = join(spec.finalPath, spec.binary)

    if (existsSync(spec.finalPath)) {
        return binary
    }

    const release = await acquireLock(root, spec.name, signal)
    let stage: string | undefined

    try {
        if (existsSync(spec.finalPath)) {
            return binary
        }

        await mkdir(join(root, 'staging'), { recursive: true })
        stage = await mkdtemp(join(root, 'staging', 'install-'))

        const response = await fetch(spec.url, { signal })

        if (!response.ok) {
            throw new Error(`Download failed: HTTP ${response.status}`)
        }

        const bytes = new Uint8Array(await response.arrayBuffer())

        verifyChecksum(bytes, spec.sha256)

        const archive = join(stage, 'archive.tar.gz')
        const tree = join(stage, 'tree')

        await writeFile(archive, bytes)
        await mkdir(tree)

        const listing = await commandOutput(['tar', '-tzf', archive], signal)

        if (
            listing.split('\n').some(path => path.startsWith('/') || path.split('/').includes('..'))
        ) {
            throw new Error('Unsafe archive paths')
        }

        await commandOutput(['tar', '-xzf', archive, '-C', tree, '--strip-components=1'], signal)

        const version = await commandOutput([join(tree, spec.binary), '--version'], signal)

        if (!version.includes(spec.version)) {
            throw new Error(`Smoke test returned unexpected version: ${version.trim()}`)
        }

        signal?.throwIfAborted()
        await mkdir(dirname(spec.finalPath), { recursive: true })
        await rename(tree, spec.finalPath)

        return binary
    } finally {
        if (stage) {
            await rm(stage, { recursive: true, force: true })
        }

        await release()
    }
}
