import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

import { expect, it } from 'vitest'

import { commandOutput } from './install'
import { runCommand } from './shell'

it('captures separate pipes, exit codes and literal argv without echoing', async () => {
    const literal = 'dummy; $(printf injected) "quoted"'
    const result = await runCommand(
        [
            'bun',
            '-e',
            'process.stdout.write(process.argv[1]); process.stderr.write("diagnostic"); process.exit(7)',
            '--',
            literal,
        ],
        process.cwd(),
        new AbortController().signal,
    )

    expect(result.stdout.toString('utf8')).toBe(literal)
    expect(result.stderr.toString('utf8')).toBe('diagnostic')
    expect(result.exitCode).toBe(7)
    await expect(
        commandOutput(['bun', '-e', 'process.stderr.write("diagnostic"); process.exit(7)']),
    ).rejects.toThrow('bun failed (exit 7): diagnostic')
})

it('cancels a running command and kills it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ft-shell-'))
    const controller = new AbortController()
    const pidPath = join(root, 'pid')
    const running = commandOutput(
        [
            'bun',
            '-e',
            'await Bun.write(process.argv[1], String(process.pid)); await Bun.sleep(30000)',
            '--',
            pidPath,
        ],
        controller.signal,
    )
    const rejected = expect(running).rejects.toThrow()

    try {
        let pid = 0

        for (let attempt = 0; attempt < 100 && !pid; attempt++) {
            pid = Number(await readFile(pidPath, 'utf8').catch(() => ''))
            await sleep(20)
        }

        expect(pid).toBeGreaterThan(0)
        controller.abort()
        await rejected

        let alive = true

        for (let attempt = 0; attempt < 100 && alive; attempt++) {
            try {
                process.kill(pid, 0)
            } catch {
                alive = false
            }

            await sleep(20)
        }

        expect(alive).toBe(false)
    } finally {
        controller.abort()
        await rejected
        await rm(root, { recursive: true, force: true })
    }
}, 10_000)
