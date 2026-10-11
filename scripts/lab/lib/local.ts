import { existsSync } from 'node:fs'
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { build } from './build'
import { LAB_ROOT, LOOPBACK_SCENARIOS, SCENARIOS } from './constants'
import { killExtract } from './faults'
import {
    archiveServer,
    configure,
    layout,
    runtimeTransport,
    scratchFixtures,
    warmRuntime,
} from './fixtures'
import { cancelGroup, distribution, killDownload, loopback, parallel, switchBuild } from './harness'
import { modelServer } from './model'
import { PrerequisiteError, signalGroup, start } from './processes'
import { realGateway, realRelease } from './real'
import { summarize } from './results'
import { pinnedBunVersion, requirePinnedBun } from './toolchain'

import type { Aggregate, Build, Context, Options, Result } from './types'

/**
 * Construct the single schema-versioned result used on either host, including errors.
 * @param scenario - selected scenario or exec
 * @param host - reporting host
 * @returns initially empty result
 */
export function resultFor(scenario: string, host: string): Result {
    return {
        schemaVersion: 1,
        runId: `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
        host,
        scenario,
        buildVersion: null,
        buildDigest: null,
        outcome: 'passed',
        assertions: [],
        phases: {},
        keptPaths: [],
        cleanup: { outcome: 'removed' },
    }
}

/**
 * Execute one timed phase with progress exclusively on stderr.
 * @param result - phase-duration owner
 * @param name - phase name
 * @param action - bounded phase implementation
 * @returns phase result
 */
export async function phase<T>(result: Result, name: string, action: () => Promise<T>): Promise<T> {
    process.stderr.write(`[lab] ${result.host} ${result.scenario}: ${name}\n`)

    const begin = performance.now()

    try {
        return await action()
    } finally {
        result.phases[name] = Math.round(performance.now() - begin)
    }
}

/**
 * Validate explicit selection before building or creating scratch state.
 * @param scenario - requested test or exec
 * @param options - caller prerequisite references
 * @param argv - ad hoc arguments
 * @returns nothing on a usable request
 */
function prerequisites(scenario: string, options: Options, argv: string[]): void {
    if (scenario !== 'exec' && !Object.hasOwn(SCENARIOS, scenario)) {
        throw new PrerequisiteError(`Unknown scenario: ${scenario}. Use lab list.`)
    }

    if (scenario === 'exec' && argv.length === 0) {
        throw new PrerequisiteError('exec requires -- <ft argv...>')
    }

    if (
        scenario === 'real-gateway' &&
        (process.platform !== 'linux' ||
            !options.project ||
            !existsSync(join(options.project, '.ft.json')))
    ) {
        throw new PrerequisiteError(
            'real-gateway requires Linux and --project <dir> with .ft.json; makes paid requests',
        )
    }

    if (scenario === 'real-release' && (!options.version || !Bun.which('gh'))) {
        throw new PrerequisiteError(
            'real-release requires --version <published-version> and real gh',
        )
    }
}

/**
 * Run with a fresh private filesystem, a minimal dummy-only environment and owned cleanup.
 * @param scenarios - ordered named scenarios or exec
 * @param options - host-local command options
 * @param argv - literal ft arguments for exec, otherwise empty
 * @returns ordered terminal results, each saved under the lab's results directory
 */
export async function local(
    scenarios: string[],
    options: Options,
    argv: string[] = [],
): Promise<Result[]> {
    const buildCache = options.cold
        ? join(LAB_ROOT, 'runs', resultFor('build', options.host).runId, 'cache')
        : join(LAB_ROOT, 'cache')
    const results: Result[] = []
    let compiled: Promise<Build> | undefined
    const pinned = pinnedBunVersion().then(version => requirePinnedBun(Bun.version, version))

    /* A rejected prerequisite is consumed by each result, not an unhandled promise. */
    void pinned.catch(() => {})

    try {
        for (const scenario of scenarios) {
            results.push(
                await runOne(scenario, options, argv, buildCache, async result => {
                    await pinned
                    compiled ??= phase(result, 'build', () => build(buildCache))

                    return compiled
                }),
            )
        }
    } finally {
        if (options.cold) {
            try {
                await rm(join(buildCache, '..'), { recursive: true, force: true })
            } catch (error) {
                for (const result of results) {
                    result.cleanup = { outcome: 'failed', error: String(error) }
                    result.outcome = 'lab_error'
                }
            }
        }
    }

    return results
}

/**
 * Execute one scenario using the invocation's shared native build.
 * @param scenario - exact scenario name
 * @param options - scratch lifecycle options
 * @param argv - literal ad hoc ft arguments
 * @param buildCache - invocation-wide build/runtime cache root
 * @param prepare - once-per-host compiler and prerequisite preparation
 * @returns persisted scenario result
 */
async function runOne(
    scenario: string,
    options: Options,
    argv: string[],
    buildCache: string,
    prepare: (result: Result) => Promise<Build>,
): Promise<Result> {
    const result = resultFor(scenario, options.host === 'air' ? 'air' : 'local')
    const directory = join(LAB_ROOT, 'runs', result.runId)
    const persistentCache = join(LAB_ROOT, 'cache')
    const archiveDirectory = options.archives ?? join(persistentCache, 'archives')
    let context: Context | undefined
    let fixture: ReturnType<typeof Bun.serve> | undefined

    try {
        prerequisites(scenario, options, argv)

        const compiled = await prepare(result)

        await mkdir(directory, { recursive: true, mode: 0o700 })
        await chmod(directory, 0o700)
        await layout(directory)

        result.buildVersion = compiled.version
        result.buildDigest = compiled.digest
        context = {
            directory,
            cache: buildCache,
            build: compiled,
            project: join(directory, 'project'),
            result,
            processes: new Map(),
            childStderr: [],
            env: {
                PATH: `${join(directory, 'bin')}:${process.platform === 'darwin' ? '/usr/bin:/bin:/usr/sbin:/sbin' : '/usr/bin:/bin'}`,
                HOME: join(directory, 'home'),
                XDG_CACHE_HOME: join(directory, 'xdg'),
                XDG_CONFIG_HOME: join(directory, 'config'),
                XDG_DATA_HOME: join(directory, 'data'),
                TMPDIR: join(directory, 'temp'),
                FT_INSTALL_DIR: join(directory, 'install'),
                FAKE_CALLS: join(directory, 'gh.calls'),
                LANG: 'en_US.UTF-8',
                TERM: 'dumb',
            },
        }
        await writeFile(
            join(directory, 'owner.json'),
            JSON.stringify({
                runId: result.runId,
                pid: process.pid,
                directory,
                startedAt: new Date().toISOString(),
            }),
        )
        await scratchFixtures(context)

        const run = context
        const needsRuntime =
            scenario !== 'switch' &&
            scenario !== 'kill-download' &&
            scenario !== 'kill-extract' &&
            scenario !== 'configuration-error' &&
            scenario !== 'research' &&
            scenario !== 'real-release' &&
            scenario !== 'real-gateway' &&
            !(scenario === 'exec' && !argv.includes('run'))

        if (needsRuntime) {
            fixture = await phase(result, 'fixtures', () =>
                archiveServer(compiled, archiveDirectory),
            )

            const port = Number(fixture.port)

            await runtimeTransport(run, port)

            if (scenario !== 'parallel' && scenario !== 'distribution' && !options.cold) {
                await phase(result, 'runtime', () => warmRuntime(run, port))
            }
        } else if (!scenario.startsWith('real-')) {
            const blocked = Bun.serve({
                hostname: '127.0.0.1',
                port: 0,
                fetch: () => new Response('No archive fixture configured', { status: 404 }),
            })

            fixture = blocked
            await runtimeTransport(run, Number(blocked.port))
        }

        await phase(result, 'scenario', async () => {
            if (Object.hasOwn(LOOPBACK_SCENARIOS, scenario)) {
                await loopback(run, scenario as keyof typeof LOOPBACK_SCENARIOS)
            } else if (scenario === 'distribution') {
                await distribution(run)
            } else if (scenario === 'switch') {
                await switchBuild(run)
            } else if (scenario === 'parallel') {
                await parallel(run)
            } else if (scenario === 'kill-download') {
                await killDownload(run)
            } else if (scenario === 'kill-extract') {
                await killExtract(run, archiveDirectory)
            } else if (scenario === 'cancel-group') {
                await cancelGroup(run)
            } else if (scenario === 'real-gateway') {
                await realGateway(run, options)
            } else if (scenario === 'real-release') {
                await realRelease(run, options)
            } else {
                await adHoc(run, argv)
            }
        })

        if (result.assertions.some(assertion => !assertion.passed)) {
            result.outcome = 'failed'
        }
    } catch (error) {
        result.outcome = error instanceof PrerequisiteError ? 'prerequisite_error' : 'lab_error'
        result.error = error instanceof Error ? error.message : String(error)
        process.stderr.write(`${result.error}\n`)
    } finally {
        try {
            await phase(result, 'cleanup', async () => {
                if (fixture) {
                    await fixture.stop(true)
                }

                if (context) {
                    if (result.assertions.some(assertion => !assertion.passed)) {
                        result.childStderr = context.childStderr
                    }

                    for (const pid of context.processes.keys()) {
                        signalGroup(pid, 'SIGKILL')
                    }

                    await writeFile(join(directory, 'result.json'), JSON.stringify(result, null, 4))
                }

                if (options.keep && existsSync(directory)) {
                    result.cleanup = { outcome: 'kept' }
                    result.keptPaths.push(directory)
                } else {
                    await rm(directory, { recursive: true, force: true })
                }
            })
        } catch (error) {
            result.cleanup = {
                outcome: 'failed',
                error: error instanceof Error ? error.message : String(error),
            }
            result.outcome = 'lab_error'
        }
    }

    try {
        await mkdir(join(LAB_ROOT, 'results'), { recursive: true, mode: 0o700 })
        await writeFile(
            join(LAB_ROOT, 'results', `${result.runId}.json`),
            JSON.stringify(result, null, 4),
            { mode: 0o600 },
        )

        if (options.keep && existsSync(directory)) {
            await writeFile(join(directory, 'result.json'), JSON.stringify(result, null, 4))
        }
    } catch (error) {
        result.outcome = 'lab_error'
        result.error = `Result persistence failed: ${String(error)}`
    }

    if (process.env.FT_LAB_REMOTE !== '1') {
        summarize(result)
    }

    return result
}

/**
 * Run arbitrary ft arguments with a host-local dummy model rather than a live gateway.
 * @param context - owned scratch project and current build
 * @param argv - literal ft arguments, never interpreted by a shell
 * @returns completion of captured child output
 */
async function adHoc(context: Context, argv: string[]): Promise<void> {
    const fixture = modelServer('success')

    try {
        await configure(context, context.build, `http://127.0.0.1:${fixture.server.port}`)

        const capture = await start(
            context,
            [context.build.binary, ...argv],
            context.project,
            context.env,
        ).result

        context.result.execution = {
            exitCode: capture.code,
            stdout: capture.stdout,
            stderr: capture.stderr,
            runDirectory: context.directory,
        }

        if (capture.code !== 0) {
            context.result.outcome = 'failed'
        }
    } finally {
        await fixture.server.stop(true)
    }
}

/**
 * Convert a lab result to the stable command exit contract.
 * @param result - terminal verdict
 * @returns 0 pass, 1 assertion/ft failure, 2 prerequisite, 3 lab infrastructure failure
 */
export function resultCode(result: Result | Aggregate): number {
    return { passed: 0, failed: 1, prerequisite_error: 2, lab_error: 3 }[result.outcome]
}

/**
 * Read a retained result without emitting any child stdout.
 * @param path - result JSON path
 * @returns parsed result
 */
export async function readResult(path: string): Promise<Result> {
    return JSON.parse(await readFile(path, 'utf8')) as Result
}
