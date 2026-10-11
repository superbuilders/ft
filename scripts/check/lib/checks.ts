// Keep in sync with playcademy-arcade's workspace checks and pre-push-log contracts.

import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { CHECK_LOG_PATH, CHECKS_FAILED_EXIT_CODE } from './constants'

import type { CheckOptions, CheckResult, CheckStep } from './types'

/**
 * Build the read-only gates; pre-push adds the expensive analyses, never tests.
 *
 * @param options - mode flags
 * @returns the parallel steps for this run
 */
function buildSteps(options: CheckOptions): CheckStep[] {
    const steps: CheckStep[] = [
        { name: 'Typecheck', command: ['bun', 'run', '--silent', 'typecheck'] },
        { name: 'Lint', command: ['bunx', 'oxlint', '--deny-warnings'] },
        { name: 'Format', command: ['bunx', 'oxfmt', '--check', '.'] },
    ]

    if (options.prePush) {
        steps.push(
            {
                name: 'Lint (type-aware)',
                command: ['bunx', 'oxlint', '--type-aware', '--deny-warnings'],
            },
            { name: 'Unused code', command: ['bun', 'run', '--silent', 'knip'] },
        )
    }

    return steps
}

/**
 * Capture both output streams without dumping full tool output into the hook.
 *
 * @param step - the command and display label
 * @param cwd - absolute repository root
 * @returns the completed step, including launch failures
 */
function runStep(step: CheckStep, cwd: string): Promise<CheckResult> {
    return new Promise(resolve => {
        const [executable, ...args] = step.command
        const child = spawn(executable, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
        const chunks: Buffer[] = []

        child.stdout.on('data', (chunk: Buffer) => {
            chunks.push(chunk)
        })
        child.stderr.on('data', (chunk: Buffer) => {
            chunks.push(chunk)
        })
        child.on('error', error => {
            chunks.push(Buffer.from(`${error.message}\n`))
        })
        child.on('close', (code, signal) => {
            if (signal !== null) {
                chunks.push(Buffer.from(`Terminated by ${signal}\n`))
            }

            const exitCode = code ?? 1

            console.log(`${exitCode === 0 ? '✓' : '✗'} ${step.name} (exit ${exitCode})`)
            resolve({ step, exitCode, output: Buffer.concat(chunks).toString('utf8') })
        })
    })
}

/**
 * Run all gates in parallel and save complete failure output for hook readers.
 *
 * @param options - commander mode flags
 * @returns zero on success, or the reported-check-failure exit code
 */
export async function runChecks(options: CheckOptions): Promise<number> {
    const root = fileURLToPath(new URL('../../../', import.meta.url))
    const logPath = join(root, CHECK_LOG_PATH)

    await mkdir(dirname(logPath), { recursive: true })
    await writeFile(
        logPath,
        `Checks started at ${new Date().toISOString()} and have not finished.\n`,
    )
    console.log(`Check log: ${CHECK_LOG_PATH}`)

    const results = await Promise.all(buildSteps(options).map(step => runStep(step, root)))
    const failures = results.filter(result => result.exitCode !== 0)

    if (failures.length === 0) {
        await writeFile(logPath, `Checks passed at ${new Date().toISOString()}.\n`)

        return 0
    }

    const pointer = `Checks failed (${failures.map(result => result.step.name).join(', ')}). Full output: ${CHECK_LOG_PATH}`
    const details = failures.map(
        result =>
            `=== ${result.step.name} (exit ${result.exitCode}) ===\n$ ${result.step.command.join(' ')}\n${result.output}`,
    )

    await writeFile(logPath, `${pointer}\n\n${details.join('\n')}\n`)
    console.error(pointer)

    return CHECKS_FAILED_EXIT_CODE
}
