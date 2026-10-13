/**
 * Async step runner with spinner UI, ported from the arcade's scripts/lib: named async functions
 * run with spinner feedback, one at a time (`runStep`) or together (`runSteps`).
 */

import { bold } from 'colorette'

import { formatDuration, Spinner } from './spinner'

/**
 * Indent every line of a string with a prefix.
 *
 * @param str - text to indent
 * @param prefix - prefix for each line
 * @returns indented string
 */
function indentLines(str: string, prefix: string): string {
    return str
        .split('\n')
        .map(line => `${prefix}${line}`)
        .join('\n')
}

/**
 * Configuration for spinner output behavior.
 */
export interface RunStepOptions {
    /** Indentation level for spinner output lines. */
    indent?: number
    /** Suppress spinner display; still execute the action and return its result. */
    silent?: boolean
}

/**
 * Update a running step's label in place — passed to the action so a single
 * long step can show phase progress ("opening page" → "submitting") on one
 * spinner line instead of stacking a line per phase.
 */
export type UpdateStep = ((text: string) => void) & {
    /** Temporarily stop spinner rendering while another interactive prompt owns the terminal. */
    pause?: () => void
    /** Resume spinner rendering after a paused interactive prompt completes. */
    resume?: () => void
}

/**
 * Run a named async step with spinner feedback.
 *
 * @param text - display label while running
 * @param action - async function to execute; receives an {@link UpdateStep} to relabel the spinner in place
 * @param successText - optional override label on success (string or function of result)
 * @param options - spinner options
 * @returns the value returned by the action
 */
export async function runStep<T>(
    text: string,
    action: (update: UpdateStep) => Promise<T>,
    successText?: ((result: T) => string) | string,
    options?: RunStepOptions,
): Promise<T>

/**
 * Display a step marker without running an action.
 *
 * @param text - display label
 * @param action - undefined (no-op)
 * @param successText - optional override label
 * @param options - spinner options
 */
export async function runStep(
    text: string,
    action?: undefined,
    successText?: string,
    options?: RunStepOptions,
): Promise<undefined>

export async function runStep<T>(
    text: string,
    action?: (update: UpdateStep) => Promise<T>,
    successText?: ((result: T | undefined) => string) | string,
    options?: RunStepOptions,
): Promise<T | undefined> {
    const effectiveAction = action ?? (async () => undefined as unknown as T)
    const hasAction = action !== undefined
    const indent = options?.indent ?? 0
    const spinner = new Spinner(['task'], [text], { indent })

    if (!options?.silent) {
        spinner.start()
        spinner.updateTask('task', 'running')
    }

    /**
     * Relabel the live spinner; a no-op when silent (nothing is rendering).
     *
     * @param next - the new running label
     */
    const update = ((next: string): void => {
        if (!options?.silent) {
            spinner.setText('task', next)
        }
    }) as UpdateStep

    update.pause = () => {
        if (!options?.silent) {
            spinner.clear()
        }
    }

    update.resume = () => {
        if (!options?.silent) {
            spinner.start()
            spinner.updateTask('task', 'running')
        }
    }

    const startTime = performance.now()

    try {
        const result = await effectiveAction(update)

        if (options?.silent) {
            return result
        }

        const duration = performance.now() - startTime
        let finalText: string

        if (typeof successText === 'function') {
            finalText = successText(result)
        } else {
            finalText = successText ?? text
        }

        finalText = bold(finalText)

        if (hasAction) {
            finalText = `${finalText} ${formatDuration(duration)}`
        }

        spinner.updateTask('task', 'success', finalText)
        spinner.stop()

        return result
    } catch (error) {
        if (!options?.silent) {
            spinner.updateTask('task', 'error')
            spinner.stop()
        }

        console.error('')

        if (
            error &&
            typeof error === 'object' &&
            'exitCode' in error &&
            typeof error.exitCode === 'number'
        ) {
            console.error(`  Exit Code: ${error.exitCode}`)

            const stdout = (error as { stdout?: Buffer }).stdout?.toString().trim()
            const stderr = (error as { stderr?: Buffer }).stderr?.toString().trim()

            if (stdout) {
                console.error(`  Stdout:\n ${indentLines(stdout, '    ')}`)
            }

            if (stderr) {
                console.error(`  Stderr:\n ${indentLines(stderr, '    ')}`)
            }
        } else {
            console.error(`  Error: ${error instanceof Error ? error.message : String(error)}`)
        }

        console.error('')
        throw error
    }
}

/**
 * Configuration for a single step in a batch.
 */
interface StepConfig<T> {
    /** Display label for the step. */
    text: string
    /** Async function to execute for this step. */
    action: () => Promise<T>
    /** Optional override label on success; if a function, receives the resolved value. */
    successText?: ((result: T) => string) | string
}

/**
 * Outcome of a step in a batch run.
 */
interface StepResult<T> {
    /** Whether the step completed without throwing. */
    success: boolean
    /** The resolved value from the step; present only if `success` is true. */
    result?: T
    /** The thrown error from the step; present only if `success` is false. */
    error?: unknown
}

/**
 * Run multiple named steps in parallel with spinner feedback.
 *
 * @param steps - keyed step configs (all run concurrently)
 * @param options - spinner options
 * @returns keyed results with success/error state
 */
export async function runSteps<T extends Record<string, unknown>>(
    steps: {
        [K in keyof T]: StepConfig<T[K]>
    },
    options?: RunStepOptions,
): Promise<{ [K in keyof T]: StepResult<T[K]> }> {
    const keys = Object.keys(steps) as (keyof T)[]
    const results = {} as { [K in keyof T]: StepResult<T[K]> }
    const taskTexts = keys.map(key => steps[key].text)
    const spinner = new Spinner(keys as string[], taskTexts, options)

    spinner.start()

    const promises = keys.map(async key => {
        const step = steps[key]

        spinner.updateTask(key as string, 'running')

        const startTime = performance.now()

        try {
            const result = await step.action()
            const duration = performance.now() - startTime
            let finalText: string

            if (typeof step.successText === 'function') {
                finalText = step.successText(result)
            } else {
                finalText = step.successText ?? step.text
            }

            finalText = `${bold(finalText)} ${formatDuration(duration)}`
            spinner.updateTask(key as string, 'success', finalText)
            results[key] = { success: true, result }
        } catch (error) {
            spinner.updateTask(key as string, 'error')
            results[key] = { success: false, error }
        }
    })

    await Promise.all(promises)
    spinner.stop()

    const failedSteps = keys.filter(key => !results[key].success)

    if (failedSteps.length > 0) {
        console.error('')
        console.error('The following steps failed:')

        for (const key of failedSteps) {
            const error = results[key].error

            console.error('')
            console.error(`  ${String(key)}:`)

            if (
                error &&
                typeof error === 'object' &&
                'exitCode' in error &&
                typeof error.exitCode === 'number'
            ) {
                console.error(`    Exit Code: ${error.exitCode}`)

                const stdout = (error as { stdout?: Buffer }).stdout?.toString().trim()
                const stderr = (error as { stderr?: Buffer }).stderr?.toString().trim()

                if (stdout) {
                    console.error(`    Stdout:\n${indentLines(stdout, '      ')}`)
                }

                if (stderr) {
                    console.error(`    Stderr:\n${indentLines(stderr, '      ')}`)
                }
            } else {
                console.error(
                    `    Error: ${error instanceof Error ? error.message : String(error)}`,
                )
            }
        }

        throw new Error(`${failedSteps.length} step(s) failed: ${failedSteps.join(', ')}`)
    }

    return results
}
