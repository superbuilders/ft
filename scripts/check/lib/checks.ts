import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { runSteps } from '../../lib/run-step'
import { CHECK_LOG_PATH, CHECKS_FAILED_EXIT_CODE } from './constants'

import type { CheckOptions, CheckResult, CheckStep } from './types'

/**
 * Build the read-only gates; pre-push adds the expensive analyses, never tests.
 *
 * @param options - mode flags
 * @returns the parallel steps for this run
 */
function buildSteps(options: CheckOptions): CheckStep[] {
    /* Type-aware lint also runs every ordinary rule, so pre-push runs it instead of the plain lint. */
    const lint: CheckStep = options.prePush
        ? {
              name: 'Lint (type-aware)',
              command: ['bunx', 'oxlint', '--type-aware', '--deny-warnings'],
          }
        : { name: 'Lint', command: ['bunx', 'oxlint', '--deny-warnings'] }
    const steps: CheckStep[] = [
        { name: 'Typecheck', command: ['bun', 'run', '--silent', 'typecheck'] },
        lint,
        { name: 'Format', command: ['bunx', 'oxfmt', '--check', '.'] },
    ]

    if (options.prePush) {
        steps.push({ name: 'Unused code', command: ['bun', 'run', '--silent', 'knip'] })
    }

    return steps
}

/**
 * Run one check as its own subprocess, keeping its output out of the hook's terminal.
 *
 * @param step - the command and display label
 * @param cwd - absolute repository root
 * @returns the completed step, including launch failures
 */
function runCommand(step: CheckStep, cwd: string): Promise<CheckResult> {
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

            resolve({ step, exitCode: code ?? 1, output: Buffer.concat(chunks).toString('utf8') })
        })
    })
}

/**
 * Run all gates in parallel under one spinner and save complete failure output for hook readers.
 *
 * @param options - commander mode flags
 * @returns zero on success, or the reported-check-failure exit code
 */
export async function runChecks(options: CheckOptions): Promise<number> {
    const root = fileURLToPath(new URL('../../../', import.meta.url))
    const logPath = join(root, CHECK_LOG_PATH)
    const results: CheckResult[] = []

    await mkdir(dirname(logPath), { recursive: true })
    await writeFile(
        logPath,
        `Checks started at ${new Date().toISOString()} and have not finished.\n`,
    )
    console.log(`Check log: ${CHECK_LOG_PATH}`)

    const steps = Object.fromEntries(
        buildSteps(options).map(step => [
            step.name,
            {
                text: step.name,
                action: async () => {
                    const result = await runCommand(step, root)

                    results.push(result)

                    if (result.exitCode !== 0) {
                        throw new Error(`exit ${result.exitCode}; full output in ${CHECK_LOG_PATH}`)
                    }
                },
            },
        ]),
    )
    const passed = await runSteps(steps).then(
        () => true,
        () => false,
    )

    if (passed) {
        await writeFile(logPath, `Checks passed at ${new Date().toISOString()}.\n`)

        return 0
    }

    const failures = results.filter(result => result.exitCode !== 0)
    const pointer = `Checks failed (${failures.map(result => result.step.name).join(', ')}). Full output: ${CHECK_LOG_PATH}`
    const details = failures.map(
        result =>
            `=== ${result.step.name} (exit ${result.exitCode}) ===\n$ ${result.step.command.join(' ')}\n${result.output}`,
    )

    await writeFile(logPath, `${pointer}\n\n${details.join('\n')}\n`)
    console.error(pointer)

    return CHECKS_FAILED_EXIT_CODE
}
