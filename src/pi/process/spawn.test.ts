import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

import { expect, it } from 'vitest'

import { createJudge } from '../events/judge'
import { runPi } from './spawn'

/*
 * A Pi stand-in for RPC mode: answers each command, delivers a steer as a user message and settles,
 * and exits only when ft closes its stdin.
 */
const FAKE_RPC_PI = String.raw`#!/usr/bin/env bun
const decoder = new TextDecoder()
const out = record => process.stdout.write(JSON.stringify(record) + '\n')
let buffered = ''
for await (const chunk of Bun.stdin.stream()) {
    buffered += decoder.decode(chunk, { stream: true })
    for (let lf = buffered.indexOf('\n'); lf >= 0; lf = buffered.indexOf('\n')) {
        const command = JSON.parse(buffered.slice(0, lf))
        buffered = buffered.slice(lf + 1)
        const data = command.type === 'prompt' ? { disposition: 'started', bytes: Buffer.byteLength(command.message) } : { disposition: 'queued' }
        if (command.type === 'prompt' && process.env.FAKE_PI_REFUSE) {
            out({ id: command.id, type: 'response', command: command.type, success: false, error: 'busy' })
            continue
        }
        out({ id: command.id, type: 'response', command: command.type, success: true, data })
        if (command.type === 'prompt') out({ type: 'agent_start' })
        if (command.type === 'steer') {
            out({ type: 'message_end', message: { role: 'user', content: [{ type: 'text', text: command.message }] } })
            out({ type: 'agent_settled', aborted: false })
        }
    }
}
process.stderr.write('diagnostic')
process.exitCode = 7
`

it('sends a large brief as an RPC prompt, passes a control steer, and closes stdin once Pi settles', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ft-pi-stream-'))

    try {
        const pi = join(root, 'pi')
        const brief = 'brief caf\u00e9\u2028'.repeat(100_000)
        const events: Record<string, unknown>[] = []
        const diagnostics: Buffer[] = []
        let write: ((line: string) => void) | undefined

        await writeFile(pi, FAKE_RPC_PI, { mode: 0o700 })

        const result = await runPi({
            pi,
            cwd: root,
            brief,
            selected: { provider: 'test', model: 'test' },
            tools: ['read'],
            env: process.env,
            toolDirs: [],
            agent: root,
            tmp: root,
            contextPath: join(root, 'context.md'),
            state: createJudge(),
            control: {
                attach(writer) {
                    write = writer
                },
                observe(event) {
                    events.push(event)

                    if (event.type === 'agent_start') {
                        write?.(
                            `${JSON.stringify({ id: 'steer-1', type: 'steer', message: 'also check X' })}\n`,
                        )
                    }
                },
            },
            signal: new AbortController().signal,
            events: () => {},
            stderr: chunk => diagnostics.push(chunk),
        })

        expect(result).toEqual({ code: 7, signal: null })
        expect(events.find(event => event.id === 'brief')?.data).toEqual({
            disposition: 'started',
            bytes: Buffer.byteLength(brief),
        })
        expect(events.map(event => event.type)).toEqual([
            'response',
            'response',
            'agent_start',
            'response',
            'message_end',
            'agent_settled',
        ])
        expect(Buffer.concat(diagnostics).toString('utf8')).toBe('diagnostic')
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})

it('closes stdin when Pi refuses the brief, so Pi exits instead of waiting', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ft-pi-refused-'))

    try {
        const pi = join(root, 'pi')
        const state = createJudge()

        await writeFile(pi, FAKE_RPC_PI, { mode: 0o700 })

        const result = await runPi({
            pi,
            cwd: root,
            brief: 'brief',
            selected: { provider: 'test', model: 'test' },
            tools: ['read'],
            env: { ...process.env, FAKE_PI_REFUSE: '1' },
            toolDirs: [],
            agent: root,
            tmp: root,
            contextPath: join(root, 'context.md'),
            state,
            signal: new AbortController().signal,
            events: () => {},
            stderr: () => {},
        })

        expect(result).toEqual({ code: 7, signal: null })
        expect(state.protocolError).toBe('Pi refused the brief: busy')
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
        selected: { provider: 'test', model: 'test' },
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
        /* The hard kill has been sent; the orphaned tool vanishes once init reaps it. */
        await expect
            .poll(() => {
                try {
                    process.kill(pid, 0)

                    return true
                } catch {
                    return false
                }
            })
            .toBe(false)
    } finally {
        controller.abort()
        await running
        await rm(root, { recursive: true, force: true })
    }
}, 10_000)

/*
 * A Pi stand-in that answers every prompt with one assistant message and settles: the answers are
 * the FAKE_PI_ANSWERS list in order, and FAKE_PI_REFUSE_FOLLOW_UP refuses every prompt after the brief.
 */
const FAKE_ANSWERING_PI = String.raw`#!/usr/bin/env bun
const decoder = new TextDecoder()
const out = record => process.stdout.write(JSON.stringify(record) + '\n')
const answers = JSON.parse(process.env.FAKE_PI_ANSWERS)
let prompts = 0
let buffered = ''
for await (const chunk of Bun.stdin.stream()) {
    buffered += decoder.decode(chunk, { stream: true })
    for (let lf = buffered.indexOf('\n'); lf >= 0; lf = buffered.indexOf('\n')) {
        const command = JSON.parse(buffered.slice(0, lf))
        buffered = buffered.slice(lf + 1)
        if (command.type !== 'prompt') {
            out({ id: command.id, type: 'response', command: command.type, success: true })
            continue
        }
        if (prompts > 0 && process.env.FAKE_PI_REFUSE_FOLLOW_UP) {
            out({ id: command.id, type: 'response', command: 'prompt', success: false, error: 'busy' })
            continue
        }
        const text = answers[Math.min(prompts, answers.length - 1)]
        prompts++
        out({ id: command.id, type: 'response', command: 'prompt', success: true, data: { disposition: 'started' } })
        out({ type: 'agent_start' })
        out({ type: 'message_end', message: { role: 'user', content: [{ type: 'text', text: command.message }] } })
        out({ type: 'message_end', message: { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text }] } })
        out({ type: 'agent_settled', aborted: false })
    }
}
`

/**
 * Run the answering Pi stand-in with a settle hook.
 * @param answers - what the model says to each prompt, in order
 * @param settled - the hook under test
 * @param refuse - whether Pi refuses every prompt after the brief
 * @returns the judge and the user messages Pi received
 */
async function answering(
    answers: string[],
    settled: () => string | undefined,
    refuse = false,
): Promise<{ state: ReturnType<typeof createJudge>; prompts: string[] }> {
    const root = await mkdtemp(join(tmpdir(), 'ft-pi-follow-up-'))

    try {
        const pi = join(root, 'pi')
        const state = createJudge()
        const prompts: string[] = []

        await writeFile(pi, FAKE_ANSWERING_PI, { mode: 0o700 })
        await runPi({
            pi,
            cwd: root,
            brief: 'brief',
            selected: { provider: 'test', model: 'test' },
            tools: ['read'],
            env: {
                ...process.env,
                FAKE_PI_ANSWERS: JSON.stringify(answers),
                ...(refuse ? { FAKE_PI_REFUSE_FOLLOW_UP: '1' } : {}),
            },
            toolDirs: [],
            agent: root,
            tmp: root,
            contextPath: join(root, 'context.md'),
            state,
            control: {
                attach() {},
                observe(event) {
                    const message = event.message as
                        | { role: string; content: { text: string }[] }
                        | undefined

                    if (event.type === 'message_end' && message?.role === 'user') {
                        prompts.push(message.content[0].text)
                    }
                },
            },
            settled,
            signal: new AbortController().signal,
            events: () => {},
            stderr: () => {},
        })

        return { state, prompts }
    } finally {
        await rm(root, { recursive: true, force: true })
    }
}

it('sends the follow-up the settle hook returns, and ends Pi once it returns none', async () => {
    const follow = ['fix it', 'fix it again', undefined]
    const { state, prompts } = await answering(['one', 'two', 'three'], () => follow.shift())

    expect(prompts).toEqual(['brief', 'fix it', 'fix it again'])
    expect(state.text).toBe('three')
    expect(state.settled).toBe(true)
})

it('ends Pi at once when the settle hook returns nothing', async () => {
    const { prompts } = await answering(['only'], () => undefined)

    expect(prompts).toEqual(['brief'])
})

it('ends Pi when it refuses a follow-up, instead of waiting for it', async () => {
    const { state, prompts } = await answering(['first'], () => 'fix it', true)

    expect(prompts).toEqual(['brief'])
    expect(state.text).toBe('first')
})

it('ends Pi when the settle hook throws, instead of leaving it waiting', async () => {
    const { state, prompts } = await answering(['first'], () => {
        throw new Error('the hook failed')
    })

    expect(prompts).toEqual(['brief'])
    expect(state.text).toBe('first')
})
