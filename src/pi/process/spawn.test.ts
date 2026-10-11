import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

import { expect, it } from 'vitest'

import { createJudge } from '../events/judge'
import { runPi } from './spawn'

it('drains both streams while writing a large brief and closing stdin', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ft-pi-stream-'))

    try {
        const pi = join(root, 'pi')
        const brief = 'brief café '.repeat(100_000)
        const chunks: Buffer[] = []
        const diagnostics: Buffer[] = []

        await writeFile(
            pi,
            '#!/usr/bin/env bun\nconst text = await Bun.stdin.text(); process.stdout.write(text); process.stderr.write("diagnostic"); process.exitCode = 7\n',
            { mode: 0o700 },
        )

        const result = await runPi({
            pi,
            cwd: root,
            brief,
            selected: { model: 'test' },
            tools: ['read'],
            env: process.env,
            toolDirs: [],
            agent: root,
            tmp: root,
            contextPath: join(root, 'context.md'),
            state: createJudge(),
            signal: new AbortController().signal,
            events: chunk => chunks.push(chunk),
            stderr: chunk => diagnostics.push(chunk),
        })

        expect(result).toEqual({ code: 7, signal: null })

        const output = Buffer.concat(chunks)

        expect(output.byteLength).toBe(Buffer.byteLength(brief))
        expect(output.toString('utf8') === brief).toBe(true)
        expect(Buffer.concat(diagnostics).toString('utf8')).toBe('diagnostic')
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})

it('reports a termination signal and kills detached tools that ignore SIGTERM', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ft-pi-cancel-'))
    const controller = new AbortController()
    const pi = join(root, 'pi')
    const pidPath = join(root, 'pid')

    await writeFile(
        pi,
        '#!/usr/bin/env bun\nconst child = Bun.spawn(["sh", "-c", "trap \\\"\\\" TERM; sleep 30"], { detached: true, stdio: ["ignore", "ignore", "ignore"] }); await Bun.write("pid", String(child.pid)); await Bun.sleep(30000)\n',
        { mode: 0o700 },
    )

    const running = runPi({
        pi,
        cwd: root,
        brief: 'brief',
        selected: { model: 'test' },
        tools: ['read'],
        env: process.env,
        toolDirs: [],
        agent: root,
        tmp: root,
        contextPath: join(root, 'context.md'),
        state: createJudge(),
        signal: controller.signal,
        events: () => {},
        stderr: () => {},
    })

    try {
        let pid = 0

        for (let attempt = 0; attempt < 100 && !pid; attempt++) {
            pid = Number(await readFile(pidPath, 'utf8').catch(() => ''))
            await sleep(20)
        }

        expect(pid).toBeGreaterThan(0)
        controller.abort()
        expect(await running).toEqual({ code: null, signal: 'SIGTERM' })
        expect(() => process.kill(pid, 0)).toThrow()
    } finally {
        controller.abort()
        await running
        await rm(root, { recursive: true, force: true })
    }
}, 10_000)
