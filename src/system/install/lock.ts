import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { hostname } from 'node:os'
import { dirname, join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

import { LOCK_POLL_MS } from './constants'

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

    /* Owner-only: anything another user can write here, ft would later execute. */
    await mkdir(root, { recursive: true, mode: 0o700 })
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

                process.stderr.write(
                    `Waiting for the ${name} install lock (held by ${holder.trim()})\n`,
                )
                announced = true
            }

            await recoverLock(lock)
            await sleep(LOCK_POLL_MS, undefined, { signal })
        }
    } finally {
        await rm(candidate, { recursive: true, force: true })
    }
}
