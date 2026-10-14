import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

import { emptyProgress } from '../../project/runs/store'
import { track } from './progress'
import { storyOf } from './story'

/**
 * Read a recorded event stream.
 * @param name - stub name
 * @returns its JSONL text
 */
async function stub(name: string): Promise<string> {
    return readFile(new URL(`tests/stubs/${name}.jsonl`, import.meta.url), 'utf8')
}

describe('a run recorded through Pi 1.1.0 with tools', () => {
    it('tells its story in order, each call with its subject', async () => {
        const texts = storyOf(await stub('write-tools')).map(step => step.text)

        expect(texts).toEqual([
            expect.stringMatching(/^said: /),
            'read: src/refund.ts',
            expect.stringMatching(/^said: /),
            'write: src/refund-guard.ts',
            expect.stringMatching(/^said: /),
            expect.stringMatching(/^bash: /),
            expect.stringMatching(/^answered \(\d+ words\)$/),
        ])
    })

    it('tracks turns, tool counts, written files and usage', async () => {
        const tracker = { progress: emptyProgress(), pending: new Map<string, string>() }
        const { progress } = tracker

        const events = await stub('write-tools')

        for (const line of events.split('\n').filter(Boolean)) {
            track(tracker, JSON.parse(line) as Record<string, unknown>)
        }

        expect(progress.turns).toBe(4)
        expect(progress.tools).toEqual({ read: 1, write: 1, bash: 1 })
        expect(progress.files).toEqual(['src/refund-guard.ts'])
        expect(progress.usage.input).toBeGreaterThan(0)
    })
})

describe('a run that ended in a model error', () => {
    it('ends its story with the error', async () => {
        const steps = storyOf(await stub('overflow'))

        expect(steps.at(-1)?.text).toMatch(/^model error: /)
    })
})

it('skips lines that are not events', () => {
    expect(storyOf('not json\n[1]\n\n')).toEqual([])
})

it('lists a file only once its write succeeds', () => {
    const tracker = { progress: emptyProgress(), pending: new Map<string, string>() }

    for (const [id, path, isError] of [
        ['a', 'src/kept.ts', false],
        ['b', 'src/refused.ts', true],
    ] as const) {
        track(tracker, {
            type: 'tool_execution_start',
            toolCallId: id,
            toolName: 'write',
            args: { path },
        })
        track(tracker, { type: 'tool_execution_end', toolCallId: id, isError })
    }

    expect(tracker.progress.files).toEqual(['src/kept.ts'])
})

describe('a run recorded through Pi 1.1.0 in RPC mode and steered twice', () => {
    it('lists each delivered steer in order, timed from the first message', async () => {
        const steps = storyOf(await stub('steered'))

        expect(steps.map(step => step.text)).toEqual([
            'bash: sleep 20; echo slept',
            'steered: And after that, the word BETA.',
            'steered: Also end your reply with the word ALPHA.',
            'read: src/version.ts',
            expect.stringMatching(/^answered \(\d+ words\)$/),
        ])
        expect(steps.every(step => step.at !== null)).toBe(true)
    })
})
