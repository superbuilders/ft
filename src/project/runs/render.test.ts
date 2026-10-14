import { describe, expect, it } from 'vitest'

import {
    exitCode,
    formatDuration,
    formatTokens,
    headline,
    renderReport,
    renderTable,
    tally,
} from './render'
import settled from './tests/stubs/status.json'

import type { Status } from './types'

/**
 * A settled, successful run's status, with any fields replaced.
 * @param overrides - fields to change
 * @returns a complete status
 */
function statusWith(overrides: Partial<Status> = {}): Status {
    return { ...(settled as Status), ...overrides }
}

describe('exit codes', () => {
    it.each([
        ['success', 0],
        ['model_error', 1],
        ['lost', 1],
        ['configuration_error', 2],
        ['incomplete', 3],
        ['running', 75],
        ['timeout', 124],
        ['cancelled', 130],
    ] as const)('%s exits %i', (state, code) => {
        expect(exitCode(state)).toBe(code)
    })
})

it.each([
    [800, '0.8s'],
    [42_000, '42s'],
    [252_000, '4m12s'],
    [3_780_000, '1h03m'],
])('formats %ims as %s', (ms, text) => {
    expect(formatDuration(ms)).toBe(text)
})

it.each([
    [950, '950'],
    [38_200, '38.2k'],
    [1_200_000, '1.2M'],
])('formats %i tokens as %s', (tokens, text) => {
    expect(formatTokens(tokens)).toBe(text)
})

describe('the report', () => {
    it('leads with the verdict and facts, and ends by restating it', () => {
        const status = statusWith({
            usage: { input: 30_000, output: 8000, cacheRead: 200, cacheWrite: 0, cost: 0.12 },
            tools: { read: 3, grep: 1 },
        })
        const lines = renderReport(status, 'success', 'One real problem.\n').trimEnd().split('\n')

        expect(lines[0]).toBe(
            'review-k3x2 succeeded in 4m12s (gateway/gpt-6.1-sol, thinking high, 38.2k tokens, $0.12)',
        )
        expect(lines[1]).toBe('Tools: read 3, grep 1.')
        expect(lines).not.toContain('One real problem.')
        expect(lines.at(-1)).toMatch(
            /^review-k3x2 succeeded \(answer in .*answer\.md, 1 line; ft show review-k3x2 for every step and the answer\)$/,
        )
        expect(renderReport(status, 'success', 'One real problem.\n', true)).toContain(
            '\nOne real problem.\n',
        )
    })

    it('says what to do about a context overflow and keeps the partial answer', () => {
        const status = statusWith({
            outcome: 'model_error',
            error: "This model's maximum context length is 272000 tokens",
            contextOverflow: true,
            answer: null,
            partial: '/repo/.ft/runs/review-k3x2/partial.md',
        })
        const report = renderReport(status, 'model_error', 'Reading the refund path.')

        expect(report).toContain('Next: The brief and the files the model read did not fit')
        expect(report.trimEnd().split('\n').at(-1)).toContain('partial answer in')
        expect(renderReport(status, 'model_error', 'Reading the refund path.', true)).toContain(
            "The model's last message (not a final answer):\n\nReading the refund path.",
        )
    })

    it('names the key to check when the provider rejects it', () => {
        const status = statusWith({
            outcome: 'model_error',
            error: '401 Unauthorized: invalid x-api-key',
            answer: null,
        })

        expect(renderReport(status, 'model_error', null)).toContain(
            'Next: The provider refused the request: the key in providers.gateway.key is wrong, or it may not use this model.',
        )
        expect(
            renderReport(
                statusWith({ outcome: 'model_error', error: '529 overloaded', answer: null }),
                'model_error',
                null,
            ),
        ).toContain('If it looks transient')
    })

    it('points nowhere for a run that never started', () => {
        const status = statusWith({ outcome: 'configuration_error', error: 'no key', answer: null })

        expect(headline(status, 'configuration_error')).toBe(
            'review-k3x2 could not start (gateway/gpt-6.1-sol, thinking high)',
        )
        expect(renderReport(status, 'configuration_error', null).trimEnd().split('\n').at(-1)).toBe(
            'review-k3x2 could not start',
        )
    })
})

it('lists runs with what each is doing or why it failed', () => {
    const table = renderTable([
        {
            status: statusWith({
                id: 'slow-1a2b',
                outcome: 'running',
                activity: 'read: src/refund.ts',
            }),
            state: 'running',
        },
        {
            status: statusWith({ outcome: 'timeout', error: 'Deadline reached\nafter 600s' }),
            state: 'timeout',
        },
    ])
    const [header, running, failed] = table.trimEnd().split('\n')

    expect(header).toMatch(/^RUN\s+STATE\s+STARTED\s+TIME\s+TOKENS\s+MODEL\s+WHAT$/)
    expect(running).toMatch(/now: read: src\/refund\.ts$/)
    expect(failed).toMatch(/Deadline reached$/)
})

it('tallies runs and names each one that did not succeed', () => {
    expect(tally([{ status: statusWith({ id: 'a-1' }), state: 'success' }])).toBe(
        '1 run: 1 succeeded',
    )
    expect(
        tally([
            { status: statusWith({ id: 'a-1' }), state: 'success' },
            { status: statusWith({ id: 'b-2' }), state: 'model_error' },
            { status: statusWith({ id: 'c-3' }), state: 'timeout' },
        ]),
    ).toBe('3 runs: 1 succeeded; b-2 failed with a model provider error; c-3 timed out')
})
