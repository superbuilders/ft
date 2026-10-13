import { existsSync } from 'node:fs'
import { readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { PI_VERSION } from '../../../src/pi/runtime/constants'
import { RUN_FILES } from '../../../src/project/runs/constants'
import { exitCode } from '../../../src/project/runs/render'
import { build, digest } from './build'
import { ANSWER, DUMMY_KEY, LOOPBACK_SCENARIOS } from './constants'
import { archives, calls, configure } from './fixtures'
import { modelServer } from './model'
import { check, checkpoint, command, signalGroup, start } from './processes'

import type { Status } from '../../../src/project/runs/types'
import type { Capture, Context } from './types'

/**
 * Read protocol artifacts even when ft failed to create them.
 * @param path - artifact path
 * @returns contents or null, preserving missing-file evidence
 */
async function artifact(path: string): Promise<string | null> {
    return readFile(path, 'utf8').catch(error => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return null
        }

        throw error
    })
}

/**
 * Read the status ft printed with --json.
 * @param capture - ft process result
 * @returns the status, or null when stdout held none
 */
function recorded(capture: Capture): Status | null {
    try {
        return JSON.parse(capture.stdout) as Status
    } catch {
        return null
    }
}

/**
 * Read one file from a run's folder.
 * @param status - the run's status
 * @param file - file name inside the folder
 * @returns contents, or null when the run or the file is missing
 */
async function runFile(status: Status | null, file: string): Promise<string | null> {
    return status?.dir ? artifact(join(status.dir, file)) : null
}

/**
 * Invoke one brief with literal argv and a per-run outer deadline.
 * @param context - scratch environment
 * @param executable - compiled runner or installed shim
 * @param name - output basename
 * @param extra - additional ft arguments
 * @param selection - which brief file and role to run
 * @param selection.prompt - brief file in the project
 * @param selection.role - role to run it on
 * @returns captured process completion
 */
function brief(
    context: Context,
    executable: string,
    name: string,
    extra: string[] = [],
    { prompt = 'brief.md', role = 'code' } = {},
): Promise<Capture> {
    return start(
        context,
        [
            executable,
            'run',
            prompt,
            '--role',
            role,
            '--out',
            join(context.project, `${name}.out`),
            '--json',
            ...extra,
        ],
        context.project,
        context.env,
    ).result
}

/**
 * Compare one complete tool round trip with retained protocol evidence.
 * @param context - result and project
 * @param name - assertion and artifact prefix
 * @param capture - ft process result
 * @returns completion of evidence recording
 */
async function toolTurn(context: Context, name: string, capture: Capture): Promise<void> {
    const out = join(context.project, `${name}.out`)
    const status = recorded(capture)
    const events = await runFile(status, RUN_FILES.events)

    check(
        context.result,
        name,
        { code: 0, answer: ANSWER, outcome: 'success', tool: true, errors: 0 },
        {
            code: capture.code,
            answer: await artifact(out),
            outcome: status?.outcome ?? null,
            tool: events?.includes('tool_execution_end') && events.includes('tool-ok'),
            errors: status?.toolErrorCount ?? null,
        },
    )
}

/**
 * Exercise each original E2E behavior as an individually named scenario.
 * @param context - scratch state
 * @param name - original scenario name
 * @returns completion of named assertions
 */
export async function loopback(
    context: Context,
    name: keyof typeof LOOPBACK_SCENARIOS,
): Promise<void> {
    const fixture = modelServer(name)

    try {
        await configure(context, context.build, `http://127.0.0.1:${fixture.server.port}`)

        const out = join(context.project, `${name}.out`)
        const argv =
            name === 'compiled-success'
                ? [context.build.binary]
                : [process.execPath, resolve('src/cli.ts')]
        const role =
            (
                {
                    research: 'research',
                    'builtin-provider': 'builtin',
                    'configuration-error': 'missing',
                } as Record<string, string>
            )[name] ?? 'code'
        const child = start(
            context,
            [
                ...argv,
                'run',
                'brief.md',
                '--role',
                role,
                '--out',
                out,
                '--json',
                ...(name === 'timeout' ? ['--deadline', '1'] : []),
            ],
            context.project,
            context.env,
        )

        if (name === 'cancelled') {
            await checkpoint(() => fixture.requests.length > 0)
            process.kill(child.pid, 'SIGTERM')
        }

        const capture = await child.result
        const status = recorded(capture)
        const expected = LOOPBACK_SCENARIOS[name]
        const events = (await runFile(status, RUN_FILES.events)) ?? ''

        const stored = JSON.parse(
            (await runFile(status, RUN_FILES.status)) ?? 'null',
        ) as Status | null

        check(context.result, 'outcome', expected, status?.outcome ?? null)
        check(context.result, 'exit-code', exitCode(expected), capture.code)

        if (expected !== 'configuration_error') {
            check(context.result, 'pi-version', PI_VERSION, status?.piVersion ?? null)
        }

        check(context.result, 'answer-publication', expected === 'success', existsSync(out))

        if (expected !== 'configuration_error') {
            check(
                context.result,
                'live-status-matches',
                status?.outcome ?? null,
                stored?.outcome ?? null,
            )
        }

        check(context.result, 'key-redaction', false, capture.stderr.includes(DUMMY_KEY))

        if (name === 'success' || name === 'builtin-provider') {
            check(
                context.result,
                'tool-turn',
                { answer: ANSWER, tool: true, errors: 0 },
                {
                    answer: await artifact(out),
                    tool: events.includes('tool_execution_end') && events.includes('tool-ok'),
                    errors: status?.toolErrorCount ?? null,
                },
            )
        }

        if (name === 'builtin-provider') {
            check(
                context.result,
                'builtin-model',
                'llama-3.1-8b-instant',
                fixture.requests[0]?.model,
            )
        }

        if (name === 'success') {
            const keyCount = await artifact(join(context.project, 'key-count'))

            check(context.result, 'key-cached', '1', keyCount?.trim() ?? null)
            check(
                context.result,
                'bounded-context',
                true,
                JSON.stringify(fixture.requests).includes('E2E_CONTEXT_SENTINEL'),
            )
            check(context.result, 'settled', true, status?.settled ?? null)
        }

        if (name === 'retry-success') {
            check(context.result, 'retry-observed', true, (status?.retryCount ?? 0) > 0)
        }

        if (name === 'research') {
            const answer = await artifact(out)

            check(
                context.result,
                'citations',
                true,
                answer?.includes('## Citations\n\n1. https://example.test/source') ?? false,
            )
            check(
                context.result,
                'no-tools',
                false,
                fixture.requests.some(request => 'tools' in request),
            )
            check(
                context.result,
                'tool-free-prompt',
                false,
                fixture.requests.some(request =>
                    request.messages.some(
                        message =>
                            message.role === 'system' &&
                            JSON.stringify(message.content).includes('bash'),
                    ),
                ),
            )
        }

        check(
            context.result,
            'run-state-removed',
            [],
            await readdir(join(join(context.directory, 'xdg'), 'ft', 'runs')).catch(() => []),
        )
    } finally {
        await fixture.server.stop(true)
    }
}

/**
 * Run the real bootstrap script, installed shim, native runner and Pi tool turn cold/warm.
 * @param context - isolated install and cache paths
 * @returns completion of distribution assertions
 */
export async function distribution(context: Context): Promise<void> {
    const fixture = modelServer('distribution')

    try {
        await configure(context, context.build, `http://127.0.0.1:${fixture.server.port}`)

        const install = await start(
            context,
            ['sh', join(context.build.directory, 'install.sh')],
            context.project,
            context.env,
        ).result
        const shim = join(join(context.directory, 'install'), 'ft')

        check(context.result, 'installer', 0, install.code)
        check(context.result, 'shim-bytes', await artifact('shim/ft'), await artifact(shim))

        if (!existsSync(shim)) {
            return
        }

        await toolTurn(context, 'cold-tool-turn', await brief(context, shim, 'cold-tool-turn'))

        const runner = join(
            join(context.directory, 'xdg'),
            'ft',
            'runner',
            context.build.version,
            context.build.digest,
            'ft',
        )

        check(
            context.result,
            'runner-digest',
            context.build.digest,
            existsSync(runner) ? await digest(runner) : null,
        )

        const before = await calls(join(context.directory, 'gh.calls'))

        await toolTurn(context, 'warm-tool-turn', await brief(context, shim, 'warm-tool-turn'))
        check(
            context.result,
            'warm-no-gh',
            before,
            await calls(join(context.directory, 'gh.calls')),
        )
    } finally {
        await fixture.server.stop(true)
    }
}

/**
 * Select two genuinely versioned native binaries A, B, A in one runner cache.
 * @param context - run cache and first build
 * @returns completion of version selection assertions
 */
export async function switchBuild(context: Context): Promise<void> {
    const second = await build(context.cache, 'switch-B')

    for (const [name, selected] of [
        ['A', context.build],
        ['B', second],
        ['A-again', context.build],
    ] as const) {
        await configure(context, selected)

        const capture = await start(
            context,
            ['sh', resolve('shim/ft'), '--version'],
            context.project,
            context.env,
        ).result

        check(
            context.result,
            `${name}-version`,
            { code: 0, version: selected.version },
            { code: capture.code, version: capture.stdout.trim() },
        )
    }

    const root = join(join(context.directory, 'xdg'), 'ft', 'runner')

    const retained = await readdir(root).catch(() => [])
    const downloads = await calls(join(context.directory, 'gh.calls'))

    check(
        context.result,
        'both-retained',
        [context.build.version, second.version].toSorted(),
        retained.toSorted((a, b) => a.localeCompare(b)),
    )
    check(context.result, 'two-downloads', 2, downloads.length)
}

/**
 * Execute eight complete briefs against one empty cache and count each asset fetch.
 * @param context - empty run-local cache
 * @returns completion of contention and distinct-output assertions
 */
export async function parallel(context: Context): Promise<void> {
    const fixture = modelServer('parallel')

    try {
        await configure(context, context.build, `http://127.0.0.1:${fixture.server.port}`)

        const results = await Promise.all(
            Array.from({ length: 8 }, async (_, index) => {
                const input = join(context.project, `brief-${index}.md`)
                const out = join(context.project, `parallel-${index}.out`)

                await writeFile(input, `Use bash then answer LAB_OUTPUT_${index}`)

                const capture = await start(
                    context,
                    ['sh', resolve('shim/ft'), 'run', input, '--out', out, '--json'],
                    context.project,
                    context.env,
                ).result
                const status = recorded(capture)
                const events = (await runFile(status, RUN_FILES.events)) ?? ''

                return {
                    code: capture.code,
                    answer: await artifact(out),
                    outcome: status?.outcome ?? null,
                    tool: events.includes('tool_execution_end') && events.includes('tool-ok'),
                }
            }),
        )

        check(
            context.result,
            'eight-answers',
            Array.from({ length: 8 }, (_, index) => ({
                code: 0,
                answer: `LAB_OUTPUT_${index}`,
                outcome: 'success',
                tool: true,
            })),
            results,
        )

        const runnerDownloads = await calls(join(context.directory, 'gh.calls'))

        check(context.result, 'runner-installed-once', 1, runnerDownloads.length)

        const downloads = await calls(join(context.directory, 'runtime.calls'))

        for (const asset of archives(context.build)) {
            check(
                context.result,
                `${asset.name}-installed-once`,
                1,
                downloads.filter(call => call === asset.asset).length,
            )
        }
    } finally {
        await fixture.server.stop(true)
    }
}

/**
 * Snapshot only a known child tree for cancellation checks and cleanup ownership.
 * @param context - owning run
 * @param root - tracked group leader
 * @returns owned pid/group pairs, including detached Pi and tool groups
 */
export async function descendants(
    context: Context,
    root: number,
): Promise<{ pid: number; group: number }[]> {
    const output = await command(['ps', '-eo', 'pid=,ppid=,pgid='])
    const rows = output.stdout
        .trim()
        .split('\n')
        .map(line => line.trim().split(/\s+/).map(Number))
    const owned = new Set([root])
    let changed = true

    while (changed) {
        changed = false

        for (const [pid, parent] of rows) {
            if (pid && parent && owned.has(parent) && !owned.has(pid)) {
                owned.add(pid)
                changed = true
            }
        }
    }

    const result = rows
        .filter(([pid]) => pid && owned.has(pid))
        .map(([pid, , group]) => ({ pid: pid ?? 0, group: group ?? 0 }))

    for (const row of result) {
        context.processes.set(row.group, 'owned descendant')
    }

    await writeFile(join(context.directory, 'owned-processes.json'), JSON.stringify(result))

    return result
}

/**
 * Check whether a recorded process is still running, excluding inert zombies.
 * @param pid - owned process id
 * @returns whether the process still executes
 */
async function running(pid: number): Promise<boolean> {
    const result = await start(
        undefined,
        ['ps', '-p', String(pid), '-o', 'stat='],
        process.cwd(),
        process.env,
    ).result

    return result.code === 0 && result.stdout.trim() !== '' && !result.stdout.trim().startsWith('Z')
}

/**
 * Signal a harness-style process group after Pi actually launches a long-running tool.
 * @param context - private process ownership and runtime
 * @returns completion of both signal checks
 */
export async function cancelGroup(context: Context): Promise<void> {
    for (const signal of ['SIGTERM', 'SIGHUP'] as const) {
        const ready = join(context.project, `${signal}.pid`)
        const fixture = modelServer(
            'cancel-group',
            `printf '%s\\n' "$$" > '${ready}'; exec sleep 600`,
        )
        let owned: { pid: number; group: number }[] = []

        try {
            await configure(context, context.build, `http://127.0.0.1:${fixture.server.port}`)

            const out = join(context.project, `${signal}.out`)
            const child = start(
                context,
                [context.build.binary, 'run', 'brief.md', '--role', 'code', '--out', out, '--json'],
                context.project,
                context.env,
            )

            await checkpoint(() => existsSync(ready))
            owned = await descendants(context, child.pid)
            signalGroup(child.pid, signal)

            const status = recorded(await child.result)

            check(context.result, `${signal}-cancelled`, 'cancelled', status?.outcome ?? null)
            await checkpoint(async () => {
                const states = await Promise.all(owned.map(row => running(row.pid)))

                return !states.some(Boolean)
            }).catch(() => {})

            const survivors = await Promise.all(
                owned.map(async row => ((await running(row.pid)) ? row.pid : null)),
            )

            check(
                context.result,
                `${signal}-no-descendants`,
                [],
                survivors.filter(pid => pid !== null),
            )
        } finally {
            for (const row of owned) {
                signalGroup(row.group, 'SIGKILL')
                context.processes.delete(row.group)
            }

            await fixture.server.stop(true)
        }
    }
}

/**
 * Hard-kill the shim installer only after fake gh writes partial bytes and signals readiness.
 * @param context - fresh runner cache
 * @returns completion of recovery assertions
 */
export async function killDownload(context: Context): Promise<void> {
    const ready = join(context.directory, 'download.ready')
    const child = start(context, ['sh', resolve('shim/ft'), '--version'], context.project, {
        ...context.env,
        LAB_DOWNLOAD_CHECKPOINT: ready,
    })

    await checkpoint(() => existsSync(ready))
    await descendants(context, child.pid)
    check(context.result, 'checkpoint', true, existsSync(ready))
    signalGroup(child.pid, 'SIGKILL')
    await child.result

    const final = join(
        join(context.directory, 'xdg'),
        'ft',
        'runner',
        context.build.version,
        context.build.digest,
        'ft',
    )

    check(context.result, 'not-published', false, existsSync(final))

    const rerun = await start(
        context,
        ['sh', resolve('shim/ft'), '--version'],
        context.project,
        context.env,
    ).result

    check(
        context.result,
        'recovered',
        { code: 0, version: context.build.version },
        { code: rerun.code, version: rerun.stdout.trim() },
    )
    check(
        context.result,
        'final-digest',
        context.build.digest,
        existsSync(final) ? await digest(final) : null,
    )
    check(
        context.result,
        'no-partial-final',
        ['ft'],
        await readdir(join(final, '..')).catch(() => []),
    )
}

/**
 * Say why a live run failed, from its status, which never holds the key.
 * @param status - the run's status
 * @returns the runner's error, or null when the run succeeded
 */
function liveError(status: Status | null): string | null {
    if (status?.outcome === 'success') {
        return null
    }

    return `${status?.outcome ?? 'no status'}: ${status?.error ?? 'no error recorded'}`
}

/**
 * Assert a live-role tool event without storing or printing credential-bearing pipes.
 * @param context - compiled runner and isolated environment
 * @param role - explicit live role
 * @returns completion of real gateway assertion
 */
export async function liveToolTurn(context: Context, role: string): Promise<void> {
    const capture = await brief(context, context.build.binary, role, ['--deadline', '90'], { role })
    const status = recorded(capture)
    const events = (await runFile(status, RUN_FILES.events)) ?? ''

    check(
        context.result,
        `${role}-tool-round-trip`,
        { code: 0, tool: true, error: null },
        {
            code: capture.code,
            tool: events.includes('tool_execution_end') && !events.includes('"isError":true'),
            error: liveError(status),
        },
    )
    await rm(join(context.project, 'key-count'), { force: true })
}

/**
 * Ask the real research model one question and require a published answer with sources.
 * @param context - result and project
 * @returns completion of evidence recording
 */
export async function liveResearch(context: Context): Promise<void> {
    const out = join(context.project, 'research.out')

    await writeFile(
        join(context.project, 'research.md'),
        'In two sentences, what is the latest stable release of the Bun JavaScript runtime? Cite your sources.',
    )

    const capture = await brief(context, context.build.binary, 'research', ['--deadline', '90'], {
        prompt: 'research.md',
        role: 'research',
    })
    const answer = (await artifact(out)) ?? ''

    check(
        context.result,
        'research-answer-with-sources',
        { code: 0, answer: true, sources: true, error: null },
        {
            code: capture.code,
            answer: answer.trim().length > 0,
            sources: answer.includes('## Citations'),
            error: liveError(recorded(capture)),
        },
    )
}
