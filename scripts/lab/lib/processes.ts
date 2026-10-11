import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { isDeepStrictEqual } from 'node:util'

import { CHILD_TIMEOUT_MS, CHECKPOINT_TIMEOUT_MS, DUMMY_KEY } from './constants'

import type { Capture, Child, Context, Result } from './types'

/** A usage or missing-prerequisite failure, distinct from ft misbehavior. */
export class PrerequisiteError extends Error {
    override name = 'PrerequisiteError'
}

/**
 * Record a named comparison without stopping subsequent assertions.
 * @param result - result receiving evidence
 * @param name - stable assertion name
 * @param expected - required value
 * @param observed - actual value
 * @returns nothing
 */
export function check(result: Result, name: string, expected: unknown, observed: unknown): void {
    result.assertions.push({
        name,
        passed: isDeepStrictEqual(expected, observed),
        expected,
        observed,
    })
}

/**
 * Start a tracked process group with continuously drained pipes and an outer deadline.
 * @param context - scratch state, or undefined for infrastructure commands
 * @param argv - literal command arguments
 * @param cwd - working directory
 * @param env - explicit environment
 * @returns group leader and captured completion
 */
export function start(
    context: Context | undefined,
    argv: string[],
    cwd: string,
    env: NodeJS.ProcessEnv,
): Child {
    const executable = argv[0]

    if (!executable) {
        throw new Error('Empty subprocess argv')
    }

    const child = spawn(executable, argv.slice(1), {
        cwd,
        env,
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
    })
    const pid = child.pid ?? 0
    const diagnostic = { argv0: executable, code: 128, tail: '' }

    if (context && !context.result.scenario.startsWith('real-')) {
        context.childStderr.push(diagnostic)
    }

    let stdout = ''
    let stderr = ''
    let expired = false

    if (pid) {
        context?.processes.set(pid, executable)
    }

    child.stdout.on('data', (bytes: Buffer) => {
        stdout += bytes.toString()
    })
    child.stderr.on('data', (bytes: Buffer) => {
        stderr += bytes.toString()
    })

    const result = new Promise<Capture>((resolve, reject) => {
        const timer = setTimeout(() => {
            expired = true
            signalGroup(pid, 'SIGKILL')
            child.stdout.destroy()
            child.stderr.destroy()
            reject(new Error(`Child deadline exceeded: ${argv[0]}`))
        }, CHILD_TIMEOUT_MS)

        child.on('error', error => {
            clearTimeout(timer)
            reject(error)
        })
        child.on('close', (code, signal) => {
            clearTimeout(timer)
            context?.processes.delete(pid)
            diagnostic.code = code ?? (signal === 'SIGKILL' ? 137 : 128)
            diagnostic.tail = stderrTail(stderr)

            if (expired) {
                reject(new Error(`Child deadline exceeded: ${argv[0]}`))
            } else {
                resolve({ code: code ?? (signal === 'SIGKILL' ? 137 : 128), stdout, stderr })
            }
        })
    })

    /* Checkpoints can fail before the caller awaits the child; cleanup still owns it. */
    void result.catch(() => {})

    return { pid, result }
}

/**
 * Retain the final forty stderr lines without exposing the lab dummy credential.
 * @param stderr - drained child diagnostics
 * @returns redacted tail, excluding a trailing line terminator
 */
export function stderrTail(stderr: string): string {
    return stderr
        .replaceAll(DUMMY_KEY, '<redacted>')
        .replace(/\r?\n$/, '')
        .split(/\r?\n/)
        .slice(-40)
        .join('\n')
}

/**
 * Signal only a group explicitly started or discovered as an owned descendant.
 * @param pid - process group leader
 * @param signal - requested signal
 * @returns nothing
 */
export function signalGroup(pid: number, signal: NodeJS.Signals): void {
    if (pid <= 0) {
        return
    }

    try {
        process.kill(-pid, signal)
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
            throw error
        }
    }
}

/**
 * Wait for fixture evidence, never choose interruption timing by a fixed sleep.
 * @param predicate - checkpoint query
 * @returns completion when ready, bounded by a deadline
 */
export async function checkpoint(predicate: () => boolean | Promise<boolean>): Promise<void> {
    const end = Date.now() + CHECKPOINT_TIMEOUT_MS

    while (!(await predicate())) {
        if (Date.now() >= end) {
            throw new Error('Fixture checkpoint deadline exceeded')
        }

        await sleep(20)
    }
}

/**
 * Run an infrastructure command, rejecting nonzero exits without echoing stdout.
 * @param argv - command arguments
 * @param cwd - working directory
 * @param env - explicit environment
 * @returns captured successful command
 */
export async function command(
    argv: string[],
    cwd = process.cwd(),
    env: NodeJS.ProcessEnv = process.env,
): Promise<Capture> {
    const result = await start(undefined, argv, cwd, env).result

    if (result.code !== 0) {
        throw new Error(`${argv[0]} exited ${result.code}: ${result.stderr}`)
    }

    return result
}
