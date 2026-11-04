import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { releaseServer } from '../../../shim/tests/fakes/release-server'
import { ANSWER, DUMMY_KEY, LAB_ROOT, SCENARIOS } from './constants'
import { calls, configure, runnerDownloads, scratchFixtures } from './fixtures'
import { liveResearch } from './harness'
import { local, resultCode, resultFor } from './local'
import { modelServer } from './model'
import * as processes from './processes'
import { check, checkpoint, signalGroup, start, stderrTail } from './processes'
import { realRelease } from './real'
import { aggregate, selectScenarios } from './results'
import { requirePinnedBun } from './toolchain'

import type { Aggregate, Context } from './types'

/**
 * Run the CLI without ambient credentials, keeping its output contract observable.
 * @param args - lab command arguments
 * @param env - explicit non-secret fixture environment
 * @returns drained CLI exit and pipes
 */
function cli(args: string[], env: NodeJS.ProcessEnv = {}) {
    return start(
        undefined,
        [process.execPath, resolve('scripts/lab/index.ts'), ...args],
        process.cwd(),
        { PATH: '/usr/bin:/bin', ...env },
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
        expect(data.scenarios.find(item => item.name === 'distribution')?.assertions).toContain(
            'warm-no-download',
        )
    })

    it('emits one JSON usage result and exit 2 for invalid hosts', async () => {
        const capture = await cli(['run', 'success', '--host', 'unknown'])

        expect(capture.code).toBe(2)
        expect(JSON.parse(capture.stdout).outcome).toBe('prerequisite_error')
        expect(capture.stdout.trim().split('\n')).toHaveLength(1)
    })

    it.each([
        ['run', 'success', '--host', 'remote'],
        ['run', 'success', '--host', 'both'],
        ['exec', '--host', 'remote', '--', '--version'],
    ])('requires an explicit SSH destination for %j', async (...args) => {
        const capture = await cli(args)
        const result = JSON.parse(capture.stdout)

        expect(capture.code).toBe(2)
        expect(result.outcome).toBe('prerequisite_error')
        expect(result.error).toContain('--ssh-host <destination>')
        expect(result.error).toContain('FT_LAB_SSH_HOST')
        expect(capture.stderr).not.toContain('[lab]')
        expect(capture.stdout.trim().split('\n')).toHaveLength(1)
    })

    it('rejects the old author-specific host choice', async () => {
        const capture = await cli(['run', 'success', '--host', 'air'])

        expect(capture.code).toBe(2)
        expect(JSON.parse(capture.stdout).outcome).toBe('prerequisite_error')
    })

    it.each([
        { args: ['run', 'success', '--ssh-host', 'maintainer@lab'], host: 'maintainer@lab' },
        { args: ['exec'], host: 'lab-alias' },
    ])(
        'uses the SSH flag before the environment, or its fallback: $args',
        async ({ args, host }) => {
            const directory = await mkdtemp(join(tmpdir(), 'ft-lab-transport-'))
            const result = resultFor(args[0] === 'exec' ? 'exec' : 'success', 'remote')
            const copy = join(LAB_ROOT, 'results', `remote-${result.runId}.json`)
            const log = join(directory, 'calls')

            try {
                await writeFile(
                    join(directory, 'ssh'),
                    `#!/bin/sh
[ "$1" = "$LAB_EXPECTED_HOST" ] || exit 91
printf 'ssh\\n%s\\n%s\\n' "$1" "$2" >> "$LAB_TRANSPORT_CALLS"
case "$2" in *FT_LAB_REMOTE=1*) printf '%s\\n' "$LAB_REMOTE_RESULT" ;; esac
`,
                    { mode: 0o755 },
                )
                await writeFile(
                    join(directory, 'rsync'),
                    `#!/bin/sh
printf 'rsync\\n' >> "$LAB_TRANSPORT_CALLS"
for arg do
    printf '%s\\n' "$arg" >> "$LAB_TRANSPORT_CALLS"
    last=$arg
done
case "$last" in "$LAB_EXPECTED_HOST":*) ;; *) exit 92 ;; esac
`,
                    { mode: 0o755 },
                )

                const capture = await cli(
                    [
                        ...args,
                        '--host',
                        'remote',
                        '--archives',
                        directory,
                        ...(args[0] === 'exec' ? ['--', '--version'] : []),
                    ],
                    {
                        PATH: `${directory}:/usr/bin:/bin`,
                        FT_LAB_SSH_HOST: 'lab-alias',
                        LAB_EXPECTED_HOST: host,
                        LAB_TRANSPORT_CALLS: log,
                        LAB_REMOTE_RESULT: JSON.stringify(result),
                    },
                )
                const observed = JSON.parse(capture.stdout)
                const transportCalls = await readFile(log, 'utf8')

                expect(capture.code).toBe(0)
                expect(observed.host).toBe('remote')
                expect(observed.runId).toBe(result.runId)
                expect(transportCalls).toContain(`${host}:${LAB_ROOT}/checkout/`)
                expect(transportCalls).toContain(`${host}:${LAB_ROOT}/cache/archives/`)
                expect(transportCalls).toContain("'--host' 'remote'")
                expect(transportCalls).toContain(`rm -rf ${LAB_ROOT}/runs/${result.runId}`)
                expect(transportCalls).toContain('Darwin) os=darwin')
                expect(transportCalls).toContain('Linux) os=linux')
                expect(JSON.parse(await readFile(copy, 'utf8')).host).toBe('remote')
            } finally {
                await rm(directory, { recursive: true, force: true })
                await rm(copy, { force: true })
            }
        },
    )

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
        const remote = resultFor('parallel', 'remote')

        check(native, 'eight-answers', 8, 8)
        remote.outcome = 'lab_error'
        remote.cleanup.outcome = 'failed'

        const combined = aggregate([native, remote], 'both')

        expect(combined.outcome).toBe('lab_error')
        expect(combined.results).toEqual([native, remote])
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

    it('pins native hashes and serves selected release bytes through real curl and fetch', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'ft-lab-unit-'))
        const release = await releaseServer({
            fixtures: join(directory, 'release'),
            version: 'unconfigured',
            calls: join(directory, 'release.calls'),
        })
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
            release,
            env: {
                PATH: `${join(directory, 'bin')}:/usr/bin:/bin`,
                FT_RELEASE_URL: release.url,
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
                    'curl',
                    '-fsSL',
                    `${context.env.FT_RELEASE_URL}/download/v${context.build.version}/ft-linux-x64`,
                    '-o',
                    join(directory, 'download', 'ft-linux-x64'),
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
            expect(existsSync(join(directory, 'bin', 'gh'))).toBe(false)
            expect(context.env).not.toHaveProperty('FAKE_FIXTURES')
            expect(context.env).not.toHaveProperty('FAKE_VERSION')
            expect(release.controls.fixtures).toBe(context.build.directory)
            expect(release.controls.version).toBe(context.build.version)

            const latest = await fetch(`${release.url}/latest`, { method: 'HEAD' })

            expect(latest.url).toBe(`${release.url}/tag/v${context.build.version}`)
            expect(await runnerDownloads(context)).toEqual([
                `/download/v${context.build.version}/ft-linux-x64`,
            ])
            expect(await calls(join(directory, 'release.calls'))).toEqual([
                `/download/v${context.build.version}/ft-linux-x64`,
                `/storage/v${context.build.version}/ft-linux-x64`,
                '/latest',
                `/tag/v${context.build.version}`,
            ])

            const second = {
                ...context.build,
                version: '0.1.0-lab.second',
                directory: join(directory, 'second'),
            }

            await mkdir(second.directory)
            await writeFile(join(second.directory, 'ft-linux-x64'), 'second bytes')
            await configure(context, second)

            const response = await fetch(`${release.url}/download/v${second.version}/ft-linux-x64`)

            expect(await response.text()).toBe('second bytes')
            expect(release.controls.version).toBe(second.version)
            expect(await runnerDownloads(context)).toHaveLength(2)

            const failed = await start(
                context,
                ['sh', '-c', String.raw`printf "%s\n" "$E2E_SECRET" >&2; exit 7`],
                context.project,
                { ...context.env, E2E_SECRET: DUMMY_KEY },
            ).result

            expect(failed.code).toBe(7)
            expect(context.childStderr).toEqual([
                { argv0: 'curl', code: 0, tail: '' },
                { argv0: 'sh', code: 7, tail: '<redacted>' },
            ])
        } finally {
            await release.close()
            await rm(directory, { recursive: true, force: true })
        }
    })

    it('counts only runner asset downloads, not metadata, redirects or runtime archives', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'ft-lab-downloads-'))
        const release = await releaseServer({ fixtures: directory, version: '0.1.0' })
        const context = { directory, release } as Context

        try {
            expect(await runnerDownloads(context)).toEqual([])

            const runners = [
                '/download/v0.1.0/ft-linux-x64',
                '/download/v0.2.0-lab.second/ft-darwin-arm64',
                '/download/v0.1.0/ft-linux-arm64',
                '/download/v0.1.0/ft-darwin-x64',
            ]

            await writeFile(
                join(directory, 'release.calls'),
                [
                    '/latest',
                    '/tag/v0.1.0',
                    '/download/v0.1.0/ft-shim',
                    '/download/v0.1.0/install.sh',
                    '/download/v0.1.0/schema.json',
                    '/download/v0.1.0/SHA256SUMS',
                    '/storage/v0.1.0/ft-linux-x64',
                    '/download/v0.1.0/pi-linux-x64.tar.gz',
                    ...runners,
                ].join('\n'),
            )

            expect(await runnerDownloads(context)).toEqual(runners)
        } finally {
            await release.close()
            await rm(directory, { recursive: true, force: true })
        }
    })

    it('holds real curl at the release checkpoint, then serves complete bytes after clearing it', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'ft-lab-checkpoint-'))
        const ready = join(directory, 'download.ready')
        const release = await releaseServer({
            fixtures: directory,
            version: '0.1.0',
            checkpoint: ready,
        })
        let child: ReturnType<typeof start> | undefined

        try {
            await writeFile(join(directory, 'ft-linux-x64'), 'complete runner bytes')
            child = start(
                undefined,
                ['curl', '-fsSL', `${release.url}/download/v0.1.0/ft-linux-x64`],
                directory,
                { PATH: '/usr/bin:/bin' },
            )
            await checkpoint(() => existsSync(ready))
            signalGroup(child.pid, 'SIGKILL')
            await child.result
            delete release.controls.checkpoint

            const response = await fetch(`${release.url}/download/v0.1.0/ft-linux-x64`)

            expect(await response.text()).toBe('complete runner bytes')
        } finally {
            if (child) {
                signalGroup(child.pid, 'SIGKILL')
            }

            await release.close()
            await rm(directory, { recursive: true, force: true })
        }
    })

    it('uses public release URLs and no gh credentials for the opt-in release check', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'ft-lab-real-release-'))
        const release = await releaseServer({ fixtures: directory, version: 'unused' })
        const context: Context = {
            directory,
            cache: directory,
            project: join(directory, 'project'),
            build: {
                version: '0.1.0-lab.abc',
                digest: 'a'.repeat(64),
                target: 'linux-x64',
                directory,
                binary: join(directory, 'runner'),
            },
            result: resultFor('real-release', 'local'),
            processes: new Map(),
            childStderr: [],
            release,
            env: {
                PATH: '/usr/bin:/bin',
                FT_RELEASE_URL: release.url,
                BUN_OPTIONS: '--preload fixture.ts',
            },
        }
        const child = vi.spyOn(processes, 'start').mockReturnValue({
            pid: 0,
            result: Promise.resolve({ code: 0, stdout: '0.2.0\n', stderr: '' }),
        })
        const request = vi
            .spyOn(globalThis, 'fetch')
            .mockResolvedValue(new Response(`${'a'.repeat(64)}  ft-linux-x64\n`))

        try {
            await mkdir(context.project)
            await realRelease(context, { host: 'local', version: '0.2.0' })

            expect(request).toHaveBeenCalledExactlyOnceWith(
                'https://github.com/superbuilders/ft/releases/download/v0.2.0/SHA256SUMS',
            )
            expect(child.mock.calls.map(([, argv]) => argv)).toEqual([
                ['sh', resolve('install.sh'), '0.2.0'],
                [join(directory, 'install', 'ft'), '--version'],
            ])

            expect(child.mock.calls.map(call => call[3])).toEqual([
                { PATH: '/usr/bin:/bin' },
                { PATH: '/usr/bin:/bin' },
            ])

            expect(release.requests).toEqual([])
        } finally {
            child.mockRestore()
            request.mockRestore()
            await release.close()
            await rm(directory, { recursive: true, force: true })
        }
    })

    it.each([
        { requireCitations: true, answer: 'Research answer', passed: false },
        {
            requireCitations: true,
            answer: 'Research answer\n\n## Citations\n\n1. Source',
            passed: true,
        },
        { requireCitations: false, answer: 'Research answer', passed: true },
        { requireCitations: false, answer: ' \n ', passed: false },
    ])(
        'checks live research output without paid requests: %j',
        async ({ requireCitations, answer, passed }) => {
            const directory = await mkdtemp(join(tmpdir(), 'ft-lab-research-'))
            const binary = join(directory, 'runner')
            const release = await releaseServer({ fixtures: directory, version: 'unused' })
            const context: Context = {
                directory,
                cache: directory,
                project: directory,
                build: {
                    version: '0.1.0-lab.abc',
                    digest: 'a'.repeat(64),
                    target: 'linux-x64',
                    directory,
                    binary,
                },
                result: resultFor('real-gateway', 'local'),
                processes: new Map(),
                childStderr: [],
                release,
                env: { LAB_ANSWER: answer },
            }

            try {
                await writeFile(
                    binary,
                    `#!/bin/sh
printf '%s' "$LAB_ANSWER" > research.out
printf '%s\\n' '{"outcome":"success"}'
`,
                    { mode: 0o755 },
                )
                await liveResearch(context, requireCitations)

                expect(context.result.assertions).toHaveLength(1)
                expect(context.result.assertions[0]?.passed).toBe(passed)
                expect(context.result.assertions[0]?.observed).toEqual({
                    code: 0,
                    answer: answer.trim().length > 0,
                    ...(requireCitations ? { sources: answer.includes('## Citations') } : {}),
                    error: null,
                })
            } finally {
                await release.close()
                await rm(directory, { recursive: true, force: true })
            }
        },
    )

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
                        model: 'model-a',
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
                model: 'model-a',
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
