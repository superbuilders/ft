import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

import { createJudge, eventParser, judgeOutcome } from './judge'

describe('recorded Pi 1.1.0 protocol', () => {
    it.each([
        ['success', 'success', 0],
        ['terminal-error', 'model_error', 3],
        ['overflow', 'model_error', 0],
        ['retry-success', 'success', 1],
        ['malformed', 'protocol_error', 0],
    ])('judges %s independently of exit 0', async (name, outcome, retries) => {
        const bytes = await readFile(new URL(`tests/stubs/${name}.jsonl`, import.meta.url))
        const state = createJudge()
        const parser = eventParser(state)

        for (const byte of bytes) {
            parser.push(Buffer.from([byte]))
        }

        parser.end()
        expect(judgeOutcome(state, 0, null)).toBe(outcome)
        expect(state.retryCount).toBe(retries)
        expect(state.contextOverflow).toBe(name === 'overflow')

        if (outcome === 'success') {
            expect(state.text).toBe('Verified café\u2028answer')
        }

        if (name === 'overflow') {
            expect(state.text).toBe('')
        }
    })

    it('rejects malformed and unterminated protocol', () => {
        for (const text of [
            'not-json\n',
            '{"type":"session"}',
            '[]\n',
            '{"type":"message_end"}\n',
        ]) {
            const state = createJudge()
            const parser = eventParser(state)

            parser.push(Buffer.from(text))
            parser.end()
            expect(judgeOutcome(state, 0, null)).toBe('protocol_error')
        }
    })

    it('counts compaction and tool errors without making recovered success fail', () => {
        const state = createJudge()
        const parser = eventParser(state)

        parser.push(
            Buffer.from(
                `${[
                    { type: 'session' },
                    { type: 'agent_start' },
                    { type: 'compaction_start', reason: 'overflow' },
                    { type: 'tool_execution_end', isError: true },
                    {
                        type: 'message_end',
                        message: {
                            role: 'assistant',
                            stopReason: 'stop',
                            content: [
                                { type: 'text', text: 'one' },
                                { type: 'thinking', thinking: 'not answer' },
                                { type: 'text', text: 'two' },
                            ],
                        },
                    },
                    { type: 'agent_settled', aborted: false },
                ]
                    .map(event => JSON.stringify(event))
                    .join('\n')}\n`,
            ),
        )
        parser.end()
        expect(state.text).toBe('onetwo')
        expect(state.compactionCount).toBe(1)
        expect(state.toolErrorCount).toBe(1)
        expect(judgeOutcome(state, 0, null)).toBe('success')
        expect(judgeOutcome(state, 1, null)).toBe('runtime_error')
        state.settled = false
        expect(judgeOutcome(state, 0, null)).toBe('incomplete')
    })
})
