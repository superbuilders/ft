import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { ANSWER, DUMMY_KEY, SCENARIOS } from './constants'
import { configure, scratchFixtures } from './fixtures'
import { local, resultCode, resultFor } from './local'
import { modelServer } from './model'
import { check, start, stderrTail } from './processes'
import { aggregate, selectScenarios } from './results'
import { requirePinnedBun } from './toolchain'

import type { Aggregate, Context } from './types'

/**
 * Run the CLI without ambient credentials, keeping its output contract observable.
 * @param args - lab command arguments
 * @returns drained CLI exit and pipes
 */
function cli(args: string[]) {
    return start(
        undefined,
        [process.execPath, resolve('scripts/lab/index.ts'), ...args],
        process.cwd(),
        { PATH: '/usr/bin:/bin' },
    ).result
}

describe('lab contract', () => {
    it('lists all seventeen scenarios with stable assertion names and real opt-in flags', async () => {
        const capture = await cli(['list', '--json'])
        const data = JSON.parse(capture.stdout) as {
            schemaVersion: number
            scenarios: { name: string; assertions: string[]; explicitOnly: boolean }[]
        }

        expect(capture.code).toBe(0)
        expect(data.schemaVersion).toBe(1)
        expect(data.scenarios.map(item => item.name)).toEqual(Object.keys(SCENARIOS))
        expect(data.scenarios.filter(item => item.explicitOnly).map(item => item.name)).toEqual([
            'real-gateway',
            'real-release',
        ])
        expect(data.scenarios.every(item => item.assertions.length > 0)).toBe(true)
    })

    it('emits one JSON usage result and exit 2 for invalid hosts', async () => {
        const capture = await cli(['run', 'success', '--host', 'unknown'])

        expect(capture.code).toBe(2)
        expect(JSON.parse(capture.stdout).outcome).toBe('prerequisite_error')
        expect(capture.stdout.trim().split('\n')).toHaveLength(1)
    })

    it('rejects real checks on both hosts before any execution or transport', async () => {
        const capture = await cli(['run', 'real-gateway', '--host', 'both'])

        expect(capture.code).toBe(2)
        expect(JSON.parse(capture.stdout).outcome).toBe('prerequisite_error')
        expect(capture.stderr).not.toContain('[lab]')
    })

    it('documents live checks without running them', async () => {
        const capture = await cli(['run', '--help'])

        expect(capture.code).toBe(0)
        expect(capture.stdout).toContain('real-gateway ONLY')
        expect(capture.stdout).toContain('real-release ONLY')
    })

    it('distinguishes asserted ft failures from lab and prerequisite failures', () => {
        const result = resultFor('success', 'local')

        check(result, 'expected-child-timeout', 124, 124)
        check(result, 'answer', 'one', 'two')
        expect(result.assertions.map(assertion => assertion.passed)).toEqual([true, false])

        for (const [outcome, code] of [
            ['passed', 0],
            ['failed', 1],
            ['prerequisite_error', 2],
            ['lab_error', 3],
        ] as const) {
            result.outcome = outcome
            expect(resultCode(result)).toBe(code)
        }
    })

    it('aggregates per-host results without hiding remote infrastructure failures', () => {
        const native = resultFor('parallel', 'local')
        const air = resultFor('parallel', 'air')

        check(native, 'eight-answers', 8, 8)
        air.outcome = 'lab_error'
        air.cleanup.outcome = 'failed'

        const combined = aggregate([native, air], 'both')

        expect(combined.outcome).toBe('lab_error')
        expect(combined.results).toEqual([native, air])
        expect(Object.keys(combined)).toEqual(['schemaVersion', 'host', 'outcome', 'results'])
    })

    it('never selects real checks through --all and preserves explicit ordering', () => {
        expect(selectScenarios([], true)).toEqual(
            Object.keys(SCENARIOS).filter(name => !name.startsWith('real-')),
        )
        expect(selectScenarios(['success', 'switch'])).toEqual(['success', 'switch'])
        expect(() => selectScenarios([], false)).toThrow('requires one or more')
        expect(() => selectScenarios(['success'], true)).toThrow('not both')
    })

    it.each([[], ['success', '--all']])(
        'rejects ambiguous or empty selection %j',
        async (...args) => {
            const capture = await cli(['run', ...args])

            expect(capture.code).toBe(2)
            expect(JSON.parse(capture.stdout).outcome).toBe('prerequisite_error')
            expect(capture.stdout.trim().split('\n')).toHaveLength(1)
        },
    )

    it('returns a flat multi-scenario result and one stderr summary per scenario', async () => {
        const capture = await cli(['run', 'unknown-one', 'unknown-two'])
        const result = JSON.parse(capture.stdout) as Aggregate

        expect(capture.code).toBe(2)
        expect(capture.stdout.trim().split('\n')).toHaveLength(1)
        expect(result.host).toBe('local')
        expect(result.results.map(item => item.scenario)).toEqual(['unknown-one', 'unknown-two'])
        expect(capture.stderr.match(/^local unknown-\w+: failed$/gm)).toHaveLength(2)
    })

    it('keeps invalid scenario prerequisites isolated within one invocation', async () => {
        const results = await local(['unknown-one', 'unknown-two'], { host: 'local' })

        expect(results.map(result => resultCode(result))).toEqual([2, 2])
        expect(results.every(result => result.buildVersion === null)).toBe(true)
    })

    it('uses lab > assertion > usage > passed precedence rather than numeric maximum', () => {
        const results = ['passed', 'prerequisite_error', 'failed', 'lab_error'].map(outcome => ({
            ...resultFor('success', 'local'),
            outcome: outcome as Context['result']['outcome'],
        }))

        for (const length of [1, 2, 3, 4]) {
            const selected = results.slice(0, length)

            expect(resultCode(aggregate(selected, 'local'))).toBe([0, 2, 1, 3][length - 1])
            expect(aggregate(selected.toReversed(), 'both').outcome).toBe(selected.at(-1)?.outcome)
        }
    })

    it('refuses a different local Bun and names actual and pinned versions on one line', () => {
        expect(() => requirePinnedBun('1.3.12', '1.3.13')).toThrow(
            'Local Bun 1.3.12 differs from package.json pin 1.3.13',
        )
        expect(() => requirePinnedBun('1.3.13', '1.3.13')).not.toThrow()
    })

    it('keeps exactly forty stderr lines and redacts repeated dummy keys', () => {
        const lines = Array.from({ length: 45 }, (_, index) => `${index}: ${DUMMY_KEY}`)
        const tail = stderrTail(`${lines.join('\r\n')}\r\n`)

        expect(tail.split('\n')).toHaveLength(40)
        expect(tail.split('\n')[0]).toBe('5: <redacted>')
        expect(tail).not.toContain(DUMMY_KEY)
        expect(stderrTail('')).toBe('')
    })

    it('uses the real native hash and zero placeholders, and gh serves exact version assets', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'ft-lab-unit-'))
        const context: Context = {
            directory,
            cache: join(directory, 'cache'),
            project: join(directory, 'project'),
            build: {
                version: '0.1.0-lab.abc',
                digest: 'a'.repeat(64),
                target: 'linux-x64',
                directory: join(directory, 'release'),
                binary: join(directory, 'release', 'ft-linux-x64'),
            },
            result: resultFor('distribution', 'local'),
            processes: new Map(),
            childStderr: [],
            env: {
                PATH: `${join(directory, 'bin')}:/usr/bin:/bin`,
                FAKE_CALLS: join(directory, 'gh.calls'),
            },
        }

        try {
            for (const name of ['project', 'bin', 'release', 'download']) {
                await mkdir(join(directory, name))
            }

            await scratchFixtures(context)
            await configure(context, context.build, 'http://127.0.0.1:1')
            await writeFile(context.build.binary, 'real bytes')

            const lock = JSON.parse(await readFile(join(context.project, '.ft/lock.json'), 'utf8'))
            const capture = await start(
                context,
                [
                    'gh',
                    'release',
                    'download',
                    `v${context.build.version}`,
                    '-R',
                    'superbuilders/ft',
                    '-p',
                    'ft-linux-x64',
                    '-D',
                    join(directory, 'download'),
                ],
                context.project,
                context.env,
            ).result

            expect(lock.sha256['linux-x64']).toBe(context.build.digest)
            expect(lock.sha256['darwin-arm64']).toBe('0'.repeat(64))
            expect(Object.keys(lock.sha256)).toHaveLength(4)
            expect(capture.code).toBe(0)
            expect(await readFile(join(directory, 'download', 'ft-linux-x64'), 'utf8')).toBe(
                'real bytes',
            )

            const failed = await start(
                context,
                ['sh', '-c', String.raw`printf "%s\n" "$E2E_SECRET" >&2; exit 7`],
                context.project,
                { ...context.env, E2E_SECRET: DUMMY_KEY },
            ).result

            expect(failed.code).toBe(7)
            expect(context.childStderr).toEqual([
                { argv0: 'gh', code: 0, tail: '' },
                { argv0: 'sh', code: 7, tail: '<redacted>' },
            ])
        } finally {
            await rm(directory, { recursive: true, force: true })
        }
    })

    it('returns distinct parallel answers for text-block user content', async () => {
        const fixture = modelServer('parallel')

        try {
            const response = await fetch(
                `http://127.0.0.1:${fixture.server.port}/v1/chat/completions`,
                {
                    method: 'POST',
                    headers: {
                        authorization: `Bearer ${DUMMY_KEY}`,
                        'content-type': 'application/json',
                    },
                    body: JSON.stringify({
                        model: 'gpt-6.1-sol',
                        stream: true,
                        messages: [
                            {
                                role: 'user',
                                content: [
                                    { type: 'text', text: 'Use bash then answer LAB_OUTPUT_7' },
                                ],
                            },
                            { role: 'tool', content: 'tool-ok' },
                        ],
                    }),
                },
            )

            expect(await response.text()).toContain('LAB_OUTPUT_7')
        } finally {
            await fixture.server.stop(true)
        }
    })

    it('keeps scripted model and tool round trips on loopback', async () => {
        const fixture = modelServer('success')

        try {
            const request = {
                model: 'gpt-6.1-sol',
                messages: [{ role: 'user', content: 'Use bash' }],
                stream: true,
            }
            const url = `http://127.0.0.1:${fixture.server.port}/v1/chat/completions`
            const headers = {
                authorization: `Bearer ${DUMMY_KEY}`,
                'content-type': 'application/json',
            }
            const first = await fetch(url, {
                method: 'POST',
                headers,
                body: JSON.stringify(request),
            })

            expect(await first.text()).toContain('tool_calls')

            const second = await fetch(url, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    ...request,
                    messages: [...request.messages, { role: 'tool', content: 'tool-ok' }],
                }),
            })

            expect(await second.text()).toContain(ANSWER)
            expect(fixture.requests).toHaveLength(2)
        } finally {
            await fixture.server.stop(true)
        }
    })
})
