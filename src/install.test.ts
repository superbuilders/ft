import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { hostname, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

import { $ } from 'bun'
import { expect, it, vi } from 'vitest'

import { acquireLock, installArchive, platformTarget } from './install'

it('serializes real concurrent Bun installers and recovers a dead owner', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ft-lock-'))

    try {
        const worker = join(root, 'worker.ts')

        await writeFile(
            worker,
            `import {acquireLock} from ${JSON.stringify(resolve('src/install.ts'))}; import {existsSync, appendFileSync, mkdirSync} from 'node:fs'; const root=process.argv[2]; const release=await acquireLock(root,'pi-test'); try {if(!existsSync(root+'/final')) {appendFileSync(root+'/installs','1\\n'); await Bun.sleep(200); mkdirSync(root+'/final')}} finally {await release()}`,
        )

        const processes = Array.from({ length: 8 }, async () => {
            const result = await $`bun ${worker} ${root} < /dev/null`.quiet().nothrow()

            return result.exitCode
        })

        expect(await Promise.all(processes)).toEqual(Array.from({ length: 8 }, () => 0))
        expect(await readFile(join(root, 'installs'), 'utf8')).toBe('1\n')
        await mkdir(join(root, 'locks', 'dead.lock'))
        await writeFile(join(root, 'locks', 'dead.lock', 'owner'), `2147483647 ${hostname()}\n`)

        const release = await acquireLock(root, 'dead')

        expect(await readFile(join(root, 'locks', 'dead.lock', 'owner'), 'utf8')).toBe(
            `${process.pid} ${hostname()}\n`,
        )
        await release()
        expect(existsSync(join(root, 'locks', 'dead.lock'))).toBe(false)
    } finally {
        await rm(root, { recursive: true, force: true })
    }
}, 15_000)

it('checksum mismatch leaves no final target or lock and cleans staging', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ft-install-'))

    vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response('corrupt archive')),
    )

    try {
        const finalPath = join(root, 'pi', 'test')

        await expect(
            installArchive(root, {
                name: 'pi-test',
                finalPath,
                url: 'https://not-requested.test',
                sha256: 'a'.repeat(64),
                binary: 'pi',
                version: 'test',
            }),
        ).rejects.toThrow('SHA-256 mismatch')
        expect(existsSync(finalPath)).toBe(false)
        expect(existsSync(join(root, 'locks', 'pi-test.lock'))).toBe(false)
        expect(await readdir(join(root, 'staging'))).toEqual([])
    } finally {
        vi.unstubAllGlobals()
        await rm(root, { recursive: true, force: true })
    }
})

it('waits for ownerless and live-owner locks, and cancels without removing them', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ft-lock-wait-'))

    try {
        const lock = join(root, 'locks', 'busy.lock')

        await mkdir(lock, { recursive: true })

        const controller = new AbortController()
        const waiting = acquireLock(root, 'busy', controller.signal)
        const rejected = expect(waiting).rejects.toThrow()

        await sleep(50)
        expect(existsSync(lock)).toBe(true)
        await writeFile(join(lock, 'owner'), `${process.pid} ${hostname()}\n`)
        await sleep(50)
        controller.abort()
        await rejected
        expect(existsSync(lock)).toBe(true)
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})

it('maps only supported platform targets', () => {
    expect(platformTarget('linux', 'arm64')).toBe('linux-arm64')
    expect(() => platformTarget('win32', 'x64')).toThrow('Unsupported platform')
})
