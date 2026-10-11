/**
 * Mode flags provided by commander.
 */
export interface CheckOptions {
    /** Enable type-aware lint and unused-code detection in addition to the base gates. */
    prePush?: boolean
}

/**
 * A check executed as its own subprocess, with no shell interpolation.
 */
export interface CheckStep {
    /** Human-readable label printed in the result and failure log. */
    name: string
    /** Executable and literal arguments. */
    command: string[]
}

/**
 * Captured result of one completed check.
 */
export interface CheckResult {
    /** The step that produced this result. */
    step: CheckStep
    /** Tool exit code; nonzero means the gate failed. */
    exitCode: number
    /** Complete stdout and stderr in arrival order. */
    output: string
}
