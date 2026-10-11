import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { homedir, hostname } from 'node:os'
import { dirname, join, resolve as resolvePath } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

import { LOCK_POLL_MS, PI_SHA256, PI_VERSION, TOOL_RELEASES } from './constants'
import { runCommand } from './shell'

import type { InstallSpec, Target } from './types'

/**
 * Map runtime platform names to the binding release target.
 * @param os - runtime operating system
 * @param arch - runtime architecture
 * @returns supported release target
 */
export function platformTarget(os = process.platform, arch = process.arch): Target {
    if ((os !== 'darwin' && os !== 'linux') || (arch !== 'arm64' && arch !== 'x64')) {
        throw new Error(`Unsupported platform: ${os}-${arch}`)
    }

    return `${os}-${arch}`
}

/**
 * Resolve the shared cache layout.
 * @returns absolute ft cache root
 */
export function cacheRoot(): string {
    return resolvePath(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'ft')
}

/**
 * Check a local PID without treating permission denial as death.
 * @param pid - lock owner PID
 * @returns whether the owner might still be alive
 */
function alive(pid: number): boolean {
    try {
        process.kill(pid, 0)

        return true
    } catch (error) {
        return (error as NodeJS.ErrnoException).code !== 'ESRCH'
    }
}

/**
 * Recover a dead local owner while serializing stale-owner readers.
 * @param lock - occupied lock directory
 * @returns completion of the recovery attempt
 */
async function recoverLock(lock: string): Promise<void> {
    const recovery = join(lock, 'recovery')

    const candidate = await mkdtemp(join(dirname(lock), '.recovery-'))

    await writeFile(join(candidate, 'owner'), `${process.pid} ${hostname()}\n`)

    try {
        await rename(candidate, recovery)
    } catch (error) {
        await rm(candidate, { recursive: true, force: true })

        const code = (error as NodeJS.ErrnoException).code

        if (code === 'ENOENT') {
            return
        }

        if (!['EEXIST', 'ENOTEMPTY'].includes(code ?? '')) {
            throw error
        }

        const holder = await readFile(join(recovery, 'owner'), 'utf8').catch(() => '')
        const [pid, host] = holder.trim().split(' ')

        if (host === hostname() && Number(pid) > 0 && !alive(Number(pid))) {
            await rm(recovery, { recursive: true, force: true })
        }

        return
    }

    try {
        const owner = await readFile(join(lock, 'owner'), 'utf8').catch(() => '')
        const [pid, host] = owner.trim().split(' ')

        if (
            host === hostname() &&
            /^\d+$/.test(pid ?? '') &&
            Number(pid) > 0 &&
            !alive(Number(pid))
        ) {
            await rm(lock, { recursive: true, force: true })
        }
    } finally {
        await rm(recovery, { recursive: true, force: true })
    }
}

/**
 * Acquire the shared lock with an owner already present at publication.
 * @param root - cache root
 * @param name - protocol lock name
 * @param signal - optional interruption
 * @returns lock release function
 */
export async function acquireLock(
    root: string,
    name: string,
    signal?: AbortSignal,
): Promise<() => Promise<void>> {
    const locks = join(root, 'locks')

    await mkdir(locks, { recursive: true })

    const candidate = await mkdtemp(join(locks, '.owner-'))
    const lock = join(locks, `${name}.lock`)

    await writeFile(join(candidate, 'owner'), `${process.pid} ${hostname()}\n`, { mode: 0o600 })

    let announced = false

    try {
        while (true) {
            signal?.throwIfAborted()

            try {
                /* An ownerless shim lock must be waited on, not replaced by rename. */
                if (!existsSync(lock)) {
                    await rename(candidate, lock)

                    return () => rm(lock, { recursive: true, force: true })
                }
            } catch (error) {
                if (
                    !['EEXIST', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code ?? '')
                ) {
                    throw error
                }
            }

            if (!announced) {
                const holder = await readFile(join(lock, 'owner'), 'utf8').catch(
                    () => 'unknown owner',
                )

                process.stderr.write(`Waiting for ${name}: ${holder.trim()}\n`)
                announced = true
            }

            await recoverLock(lock)
            await sleep(LOCK_POLL_MS, undefined, { signal })
        }
    } finally {
        await rm(candidate, { recursive: true, force: true })
    }
}

/**
 * Run a noninteractive installer subprocess.
 * @param argv - executable and arguments
 * @param signal - optional cancellation
 * @returns captured stdout after a successful exit
 */
export async function commandOutput(argv: string[], signal?: AbortSignal): Promise<string> {
    const result = await runCommand(argv, process.cwd(), signal)

    if (result.exitCode !== 0) {
        throw new Error(
            `${argv[0]} failed (exit ${result.exitCode}): ${result.stderr.toString('utf8')}`,
        )
    }

    return result.stdout.toString('utf8')
}

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

/**
 * Provision Pi and both pinned search tools.
 * @param root - shared cache root
 * @param signal - run cancellation
 * @returns executable and PATH directories
 */
export async function installRuntime(
    root: string,
    signal: AbortSignal,
): Promise<{ pi: string; toolDirs: string[] }> {
    const target = platformTarget()
    const pi = await installArchive(
        root,
        {
            name: `pi-${PI_VERSION}`,
            finalPath: join(root, 'pi', PI_VERSION),
            url: `https://github.com/earendil-works/pi/releases/download/v${PI_VERSION}/pi-${target}.tar.gz`,
            sha256: PI_SHA256[target],
            binary: 'pi',
            version: PI_VERSION,
        },
        signal,
    )
    const toolDirs: string[] = []

    for (const name of ['rg', 'fd'] as const) {
        const release = TOOL_RELEASES[name]
        const asset = release.targets[target]
        const finalPath = join(root, 'tools', `${name}-${release.version}`)

        await installArchive(
            root,
            {
                name: `tool-${name}-${release.version}`,
                finalPath,
                url: `https://github.com/${release.repo}/releases/download/${release.tag}/${asset.asset}`,
                sha256: asset.sha256,
                binary: name,
                version: release.version,
            },
            signal,
        )
        toolDirs.push(finalPath)
    }

    return { pi, toolDirs }
}
