import type { CommandOptions, CommandResult } from './types'

/**
 * Run a command to completion with its pipes captured and never echoed.
 * @param argv - executable and literal arguments
 * @param cwd - command working directory
 * @param options - cancellation and whether stderr is captured
 * @param options.signal - optional cancellation; aborting kills the command
 * @param options.stderr - `ignore` discards stderr unread (default `pipe`)
 * @returns captured pipes and exit code
 */
export async function runCommand(
    argv: string[],
    cwd: string,
    { signal, stderr: errors = 'pipe' }: CommandOptions = {},
): Promise<CommandResult> {
    signal?.throwIfAborted()

    const child = Bun.spawn(argv, { cwd, signal, stdin: 'ignore', stdout: 'pipe', stderr: errors })
    const [exitCode, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).arrayBuffer(),
        new Response(child.stderr ?? undefined).arrayBuffer(),
    ])

    signal?.throwIfAborted()

    return { exitCode, stdout: Buffer.from(stdout), stderr: Buffer.from(stderr) }
}

/**
 * Run a noninteractive installer subprocess.
 * @param argv - executable and arguments
 * @param signal - optional cancellation
 * @returns captured stdout after a successful exit
 */
export async function commandOutput(argv: string[], signal?: AbortSignal): Promise<string> {
    const result = await runCommand(argv, process.cwd(), { signal })

    if (result.exitCode !== 0) {
        throw new Error(
            `${argv[0]} failed (exit ${result.exitCode}): ${result.stderr.toString('utf8').trim()}`,
        )
    }

    return result.stdout.toString('utf8')
}
