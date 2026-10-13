import { describe, expect, it } from 'vitest'

import { replay, sonar } from './sonar'

/**
 * Read the content and finish reason out of a replayed stream.
 * @param events - server-sent events
 * @returns the joined text deltas and the last finish reason
 */
function read(events: string): { text: string; finish: string | null; done: boolean } {
    const lines = events.split('\n\n').filter(Boolean)
    const chunks = lines
        .filter(line => line !== 'data: [DONE]')
        .map(
            line =>
                JSON.parse(line.slice('data: '.length)) as {
                    choices: { delta: { content?: string }; finish_reason: string | null }[]
                },
        )

    return {
        text: chunks.map(chunk => chunk.choices[0]?.delta.content ?? '').join(''),
        finish: chunks.at(-1)?.choices[0]?.finish_reason ?? null,
        done: lines.at(-1) === 'data: [DONE]',
    }
}

describe('sonar adapter', () => {
    it('replays a JSON completion as a stream with its sources in the text', () => {
        const stream = read(
            replay({
                choices: [{ message: { content: 'Answer [1].' }, finish_reason: 'stop' }],
                citations: ['https://example.test/source'],
                search_results: [
                    { title: 'Example', url: 'https://example.test', snippet: 'Snip' },
                ],
            }),
        )

        expect(stream).toEqual({
            text: 'Answer [1].\n\n## Citations\n\n1. https://example.test/source\n\n## Search results\n\n1. Example: https://example.test\n   Snip\n',
            finish: 'stop',
            done: true,
        })
    })

    it('keeps an empty answer empty so Pi reports it', () => {
        const stream = read(replay({ choices: [{ message: { content: '' } }], citations: ['x'] }))

        expect(stream.text).toBe('')
    })

    it('drops the tools Sonar cannot call', () => {
        expect(
            sonar.request?.({ model: 'sonar-pro', tools: [{}], tool_choice: 'auto', stream: true }),
        ).toEqual({ model: 'sonar-pro', stream: true })
    })

    it('passes a streamed response through untouched', async () => {
        const response = new Response('data: [DONE]\n\n', {
            headers: { 'content-type': 'text/event-stream' },
        })

        expect(await sonar.response?.(response)).toBe(response)
    })
})
