import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve as resolvePath } from 'node:path'

import { $ } from 'bun'

import { PI_VERSION, TARGETS } from '../../../src/constants'
import { installRuntime } from '../../../src/install'
import { exitCode } from '../../../src/judge'

import type { Status } from '../../../src/types'

/**
 * Assert the real tool turn, bounded context and command-key caching.
 * @param project - scratch project
 * @param out - successful answer path
 * @param events - recorded protocol
 * @param status - terminal snapshot
 * @param requests - received gateway requests
 * @returns completion of success assertions
 */
async function assertSuccess(
    project: string,
    out: string,
    events: string,
    status: Status,
    requests: Record<string, unknown>[],
): Promise<void> {
    assert.equal(await readFile(out, 'utf8'), 'Verified café\u2028answer')
    assert.ok(events.includes('tool_execution_end'))
    assert.ok(events.includes('tool-ok'))
    assert.equal(status.toolErrorCount, 0)

    const count = await readFile(join(project, 'key-count'), 'utf8')

    assert.equal(count.trim(), '1')
    assert.ok(JSON.stringify(requests).includes('E2E_CONTEXT_SENTINEL'))
    assert.equal(status.settled, true)
}

/**
 * Check transport-specific recovery and research formatting.
 * @param name - scripted scenario name
 * @param status - terminal snapshot
 * @param out - answer destination
 * @returns completion of assertions
 */
async function assertRecovery(name: string, status: Status, out: string): Promise<void> {
    if (name === 'retry-success') {
        assert.ok(status.retryCount > 0)
    }

    if (name === 'research') {
        const answer = await readFile(out, 'utf8')

        assert.ok(answer.includes('## Citations\n\n1. https://example.test/source'))
    }
}

/**
 * Build a standalone runner to exercise compiled auth command resolution.
 * @param dir - scratch binary destination directory
 * @returns compiled executable path
 */
async function compileRunner(dir: string): Promise<string> {
    const compiled = join(dir, 'ft')

    const result =
        await $`${process.execPath} build --compile ${resolvePath('src/cli.ts')} --outfile ${compiled}`
            .quiet()
            .nothrow()

    assert.equal(result.exitCode, 0, result.stderr.toString('utf8'))

    return compiled
}

/**
 * Capture a runner command, retaining a live child only for the signal scenario.
 * @param input - argv, working directory, environment and cancellation mode
 * @param input.argv - runner executable and arguments
 * @param input.cwd - scratch project directory
 * @param input.env - dummy-only test environment
 * @param input.cancel - whether to send SIGTERM during execution
 * @returns exit code and both captured output streams
 */
async function runScenario(input: {
    argv: string[]
    cwd: string
    env: NodeJS.ProcessEnv
    cancel: boolean
}): Promise<{ code: number; stdout: string; stderr: string }> {
    if (!input.cancel) {
        const result = await $`${input.argv} < /dev/null`
            .cwd(input.cwd)
            .env(input.env)
            .quiet()
            .nothrow()

        return {
            code: result.exitCode,
            stdout: result.stdout.toString('utf8'),
            stderr: result.stderr.toString('utf8'),
        }
    }

    const child = Bun.spawn(input.argv, {
        cwd: input.cwd,
        env: input.env,
        stdout: 'pipe',
        stderr: 'pipe',
    })
    const cancellation = setTimeout(() => child.kill('SIGTERM'), 800)

    try {
        const [code, stdout, stderr] = await Promise.all([
            child.exited,
            new Response(child.stdout).text(),
            new Response(child.stderr).text(),
        ])

        return { code, stdout, stderr }
    } finally {
        clearTimeout(cancellation)
    }
}

/**
 * Exercise the actual Pi binary against loopback-only scripted OpenAI responses.
 * @param record - whether to refresh recorded unit-test protocol fixtures
 * @returns completion of all end-to-end assertions
 */
export async function e2e(record: boolean): Promise<void> {
    const dir = await mkdtemp(join(tmpdir(), 'ft-e2e-'))
    const cache = join(dir, 'cache', 'ft')
    const requests: Record<string, unknown>[] = []
    let scenario = 'success'
    let attempt = 0
    const server = Bun.serve({
        hostname: '127.0.0.1',
        port: 0,
        async fetch(request) {
            assert.equal(new URL(request.url).pathname, '/v1/chat/completions')
            assert.equal(request.headers.get('authorization'), 'Bearer e2e-dummy-not-a-real-key')

            const body = (await request.json()) as Record<string, unknown>

            requests.push(body)
            attempt++

            if (body.stream === false) {
                return Response.json({
                    choices: [{ message: { content: 'Research answer' }, finish_reason: 'stop' }],
                    citations: ['https://example.test/source'],
                    search_results: [
                        { title: 'Example', url: 'https://example.test', snippet: 'Snippet' },
                    ],
                })
            }

            if (scenario === 'terminal-error' || (scenario === 'retry-success' && attempt === 1)) {
                return Response.json(
                    {
                        error: {
                            message:
                                scenario === 'terminal-error' ? 'Invalid model' : '503 overloaded',
                            type: 'server_error',
                        },
                    },
                    { status: scenario === 'terminal-error' ? 400 : 503 },
                )
            }

            if (scenario === 'overflow') {
                return Response.json(
                    {
                        error: {
                            message: 'maximum context length exceeded',
                            type: 'invalid_request_error',
                        },
                    },
                    { status: 400 },
                )
            }

            if (scenario === 'timeout') {
                await new Promise(resolve => setTimeout(resolve, 5000))
            }

            const messages = body.messages as { role: string }[]
            const toolDone = messages.some(message => message.role === 'tool')
            const delta =
                scenario === 'success' && !toolDone
                    ? {
                          tool_calls: [
                              {
                                  index: 0,
                                  id: 'call_e2e',
                                  type: 'function',
                                  function: {
                                      name: 'bash',
                                      arguments:
                                          '{"command":"test -z \\"$OPENAI_API_KEY$ANTHROPIC_AUTH_TOKEN$E2E_SECRET\\" && printf tool-ok"}',
                                  },
                              },
                          ],
                      }
                    : { content: 'Verified café\u2028answer' }
            const chunk = {
                id: 'chat-e2e',
                object: 'chat.completion.chunk',
                created: 1,
                model: body.model,
                choices: [
                    { index: 0, delta: { role: 'assistant', ...delta }, finish_reason: null },
                ],
            }
            const final = {
                ...chunk,
                choices: [
                    {
                        index: 0,
                        delta: {},
                        finish_reason: 'tool_calls' in delta ? 'tool_calls' : 'stop',
                    },
                ],
                usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
            }

            return new Response(
                `data: ${JSON.stringify(chunk)}\n\ndata: ${JSON.stringify(final)}\n\ndata: [DONE]\n\n`,
                { headers: { 'Content-Type': 'text/event-stream' } },
            )
        },
    })

    try {
        await installRuntime(cache, new AbortController().signal)

        const compiled = await compileRunner(dir)

        const project = join(dir, 'project')

        await mkdir(project)
        await writeFile(join(project, 'AGENTS.md'), 'E2E_CONTEXT_SENTINEL')
        await writeFile(join(project, 'brief.md'), 'Use the bash tool, then answer.')
        await writeFile(
            join(project, 'key.ts'),
            "import { appendFileSync } from 'node:fs'; appendFileSync('key-count', '1\\n'); process.stdout.write(process.env.E2E_SECRET ?? '')\n",
        )
        await writeFile(
            join(project, '.ft.json'),
            JSON.stringify({
                version: '0.1.0',
                sha256: Object.fromEntries(TARGETS.map(target => [target, 'a'.repeat(64)])),
                apiKey: { command: [process.execPath, 'key.ts'] },
                gateway: { baseUrl: `http://127.0.0.1:${server.port}` },
            }),
        )

        for (const name of [
            'success',
            'terminal-error',
            'overflow',
            'retry-success',
            'research',
            'timeout',
            'configuration-error',
            'compiled-success',
            'cancelled',
        ]) {
            scenario = name === 'cancelled' ? 'timeout' : name
            attempt = 0

            const out = join(project, `${name}.out`)
            const args = [
                process.execPath,
                resolvePath('src/cli.ts'),
                'run',
                '--brief',
                'brief.md',
                '--lane',
                (
                    { research: 'research', 'configuration-error': 'missing' } as Record<
                        string,
                        string
                    >
                )[name] ?? 'smart',
                '--out',
                out,
            ]

            if (name === 'timeout') {
                args.push('--deadline', '1')
            }

            const argv = name === 'compiled-success' ? [compiled, ...args.slice(2)] : args
            const env = {
                ...process.env,
                FT_CONFIG: join(project, '.ft.json'),
                XDG_CACHE_HOME: join(dir, 'cache'),
                E2E_SECRET: 'e2e-dummy-not-a-real-key',
                OPENAI_API_KEY: 'dummy-removed',
                ANTHROPIC_AUTH_TOKEN: 'dummy-removed',
                PI_CODING_AGENT_DIR: '/must-not-be-used',
            }
            const { code, stdout, stderr } = await runScenario({
                argv,
                cwd: project,
                env,
                cancel: name === 'cancelled',
            })

            assert.equal(stdout, '')
            assert.ok(!stderr.includes('e2e-dummy-not-a-real-key'))

            const status = JSON.parse(await readFile(`${out}.status.json`, 'utf8')) as Status
            const expected = {
                success: 'success',
                'terminal-error': 'model_error',
                overflow: 'model_error',
                'retry-success': 'success',
                research: 'success',
                timeout: 'timeout',
                'configuration-error': 'configuration_error',
                'compiled-success': 'success',
                cancelled: 'cancelled',
            }[name]

            assert.equal(status.outcome, expected, `${name}: ${stderr}\n${JSON.stringify(status)}`)
            assert.equal(code, exitCode(status.outcome))
            assert.equal(status.piVersion, PI_VERSION)
            assert.equal(existsSync(out), status.outcome === 'success')

            const events = await readFile(`${out}.events.jsonl`, 'utf8')

            if (name === 'success') {
                await assertSuccess(project, out, events, status, requests)
            }

            await assertRecovery(name, status, out)

            if (
                record &&
                ['success', 'terminal-error', 'overflow', 'retry-success'].includes(name)
            ) {
                const redacted = events
                    .replaceAll(project, '/fixture/project')
                    .replaceAll(dir, '/fixture')

                await writeFile(resolvePath('src/tests/stubs', `${name}.jsonl`), redacted)
            }

            process.stdout.write(`✓ ${name}\n`)
        }

        assert.deepEqual(await Array.fromAsync(new Bun.Glob('*').scan(join(cache, 'runs'))), [])
        process.stdout.write(
            '✓ Pi 1.1.0 auth command cached once across tool turns; no key in tool env; run state removed\n',
        )
    } finally {
        await server.stop(true)
        await rm(dir, { recursive: true, force: true })
    }
}
