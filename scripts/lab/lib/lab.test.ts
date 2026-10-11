import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { ANSWER, DUMMY_KEY, SCENARIOS } from './constants'
import { configure, scratchFixtures } from './fixtures'
import { resultCode, resultFor } from './local'
import { modelServer } from './model'
import { check, start } from './processes'
import { both } from './remote'

import type { Context } from './types'

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
        const local = resultFor('parallel', 'local')
        const air = resultFor('parallel', 'air')

        check(local, 'eight-answers', 8, 8)
        air.outcome = 'lab_error'
        air.cleanup.outcome = 'failed'

        const combined = both([local, air], 'parallel')

        expect(combined.outcome).toBe('lab_error')
        expect(combined.cleanup.outcome).toBe('failed')
        expect(combined.assertions[0]?.name).toBe('local:eight-answers')
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

            const config = JSON.parse(await readFile(join(context.project, '.ft.json'), 'utf8'))
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

            expect(config.sha256['linux-x64']).toBe(context.build.digest)
            expect(config.sha256['darwin-arm64']).toBe('0'.repeat(64))
            expect(Object.keys(config.sha256)).toHaveLength(4)
            expect(capture.code).toBe(0)
            expect(await readFile(join(directory, 'download', 'ft-linux-x64'), 'utf8')).toBe(
                'real bytes',
            )
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
