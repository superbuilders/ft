import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, expect, it } from 'vitest'

import { createSteering, sendSteer, serveSteering } from './steering'

import type { SteerRecord } from './types'

const directories: string[] = []

afterEach(async () => {
    await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

/**
 * A steering controller over a fresh log, with every line it writes to Pi kept.
 * @returns the steering, the commands sent to Pi, and a reader for its log
 */
async function setup() {
    const dir = await mkdtemp(join(tmpdir(), 'ft-steering-'))
    const log = join(dir, 'steers.jsonl')
    const sent: Record<string, unknown>[] = []
    const steering = createSteering(log)

    directories.push(dir)
    steering.control.attach(line => sent.push(JSON.parse(line) as Record<string, unknown>))

    return {
        dir,
        steering,
        sent,

        /**
         * Read the log once every record is written.
         * @returns its records
         */
        async records(this: void): Promise<SteerRecord[]> {
            const text = await readFile(log, 'utf8').catch(() => '')

            return text
                .split('\n')
                .filter(Boolean)
                .map(line => JSON.parse(line) as SteerRecord)
        },
    }
}

/**
 * A user message as Pi reports it on delivery.
 * @param text - the message text
 * @returns a message_end event
 */
function userMessage(text: string): Record<string, unknown> {
    return { type: 'message_end', message: { role: 'user', content: [{ type: 'text', text }] } }
}

it('queues a steer when Pi acknowledges it and records its delivery', async () => {
    const { steering, sent, records } = await setup()
    const receipt = steering.submit('also check X')

    expect(sent).toEqual([{ id: 'steer-1', type: 'steer', message: 'also check X' }])
    steering.control.observe({ id: 'steer-1', type: 'response', command: 'steer', success: true })
    expect(await receipt).toEqual({ id: 1, state: 'queued' })

    steering.control.observe(userMessage('the brief'))
    steering.control.observe(userMessage('also check X'))
    await steering.close('done')

    const logged = await records()

    expect(logged.map(record => record.state)).toEqual(['sent', 'queued', 'delivered'])
    expect(logged[0]?.message).toBe('also check X')
    expect(steering.counts()).toEqual({ delivered: 1, undelivered: 0 })
})

it('matches identical messages to steers in the order they were sent', async () => {
    const { steering } = await setup()

    void steering.submit('same')
    void steering.submit('same')
    steering.control.observe(userMessage('same'))

    expect(steering.counts()).toEqual({ delivered: 1, undelivered: 0 })
    await steering.close('done')
    expect(steering.counts()).toEqual({ delivered: 1, undelivered: 1 })
})

it('reports a steer Pi refuses', async () => {
    const { steering, records } = await setup()
    const receipt = steering.submit('nope')

    steering.control.observe({ id: 'steer-1', type: 'response', success: false, error: 'busy' })
    expect(await receipt).toEqual({ id: 1, state: 'refused', reason: 'Pi refused it: busy' })
    await steering.close('done')

    const logged = await records()

    expect(logged.at(-1)?.state).toBe('refused')
})

it('marks steers still on their way undelivered once Pi settles, and refuses later ones', async () => {
    const { steering, records } = await setup()
    const unacknowledged = steering.submit('first')

    steering.control.observe({ type: 'agent_settled', aborted: false })
    expect(await unacknowledged).toEqual({
        id: 1,
        state: 'undelivered',
        reason: 'the run finished before the model read it',
    })
    expect(await steering.submit('second')).toEqual({
        state: 'refused',
        reason: 'the run is not taking steers',
    })
    await steering.close('done')

    const logged = await records()

    expect(logged.map(record => record.state)).toEqual(['sent', 'undelivered'])
})

it('refuses steers before Pi is attached, and empty or oversized ones', async () => {
    const before = createSteering(join(tmpdir(), 'unused-steers.jsonl'))

    const early = await before.submit('early')

    expect(early.state).toBe('refused')

    const { steering, sent } = await setup()
    const blank = await steering.submit('  ')
    const oversized = await steering.submit('x'.repeat(20_001))

    expect(blank.state).toBe('refused')
    expect(oversized.state).toBe('refused')
    expect(sent).toEqual([])
})

it('carries a steer from ft steer to the runner over the run socket', async () => {
    const { dir, steering, sent } = await setup()
    const socket = join(dir, 'control.sock')
    const stop = serveSteering(socket, steering)

    try {
        const receipt = sendSteer(socket, 'over the socket')

        await expect.poll(() => sent.length).toBe(1)
        steering.control.observe({ id: 'steer-1', type: 'response', success: true })
        expect(await receipt).toEqual({ id: 1, state: 'queued' })
    } finally {
        await stop()
    }
})
