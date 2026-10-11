import type { CommandResult } from './types'

/**
 * Run a command to completion with both pipes captured and never echoed.
 * @param argv - executable and literal arguments
 * @param cwd - command working directory
 * @param signal - optional cancellation; aborting kills the command
 * @returns captured pipes and exit code
 */
export async function runCommand(
    argv: string[],
    cwd: string,
    signal?: AbortSignal,
): Promise<CommandResult> {
    signal?.throwIfAborted()

    const child = Bun.spawn(argv, { cwd, signal, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' })
    const [exitCode, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).arrayBuffer(),
        new Response(child.stderr).arrayBuffer(),
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
    const result = await runCommand(argv, process.cwd(), signal)

    if (result.exitCode !== 0) {
        throw new Error(
            `${argv[0]} failed (exit ${result.exitCode}): ${result.stderr.toString('utf8')}`,
        )
    }

    return result.stdout.toString('utf8')
}
