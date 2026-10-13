/**
 * Multi-task terminal spinner with braille animation, ported from the arcade's scripts/lib.
 */

import { stderr } from 'node:process'

import { blue, dim, gray, green, red } from 'colorette'

import { cursor, isProgressInteractive } from './ansi'

const SPINNER_FRAMES = [
    0x28_0b, 0x28_19, 0x28_39, 0x28_38, 0x28_3c, 0x28_34, 0x28_26, 0x28_27, 0x28_07, 0x28_0f,
].map(code => String.fromCodePoint(code))
const CHECK_MARK = String.fromCodePoint(0x27_14) // ✔
const CROSS_MARK = String.fromCodePoint(0x27_16) // ✖
const CANCEL_MARK = String.fromCodePoint(0x25_cb) // ○
const SPINNER_INTERVAL = 80

/**
 * State of a single task tracked by the spinner.
 */
interface TaskState {
    /** Display label for the task — set from the constructor's `texts` array. */
    text: string
    /** Lifecycle state of the task, updated via `updateTask()`. */
    status: 'pending' | 'running' | 'success' | 'error' | 'cancelled'
    /** Optional override text for terminal states (success, error, cancelled); takes precedence over `text` when set. */
    finalText?: string
}

/**
 * Configuration options for the Spinner.
 */
export interface SpinnerOptions {
    /** Indentation level — repeated as pairs of spaces before each task line. */
    indent?: number
}

/**
 * Animated multi-task spinner for interactive terminals.
 * Falls back to plain-text logging in non-interactive environments.
 */
export class Spinner {
    private readonly tasks = new Map<string, TaskState>()
    private frameIndex = 0
    private intervalId: NodeJS.Timeout | null = null
    private renderCount = 0
    private previousLineCount = 0
    private readonly printedTasks = new Set<string>()
    private readonly indent: number

    /**
     * @param taskIds - unique identifiers for each task
     * @param texts - display labels for each task
     * @param options - spinner options
     */
    constructor(taskIds: string[], texts: string[], options?: SpinnerOptions) {
        this.indent = options?.indent ?? 0
        taskIds.forEach((id, index) => {
            this.tasks.set(id, {
                text: texts[index] || '',
                status: 'pending',
            })
        })
    }

    /**
     * Begin rendering the spinner animation.
     */
    start() {
        if (isProgressInteractive) {
            stderr.write(cursor.hide)

            this.render()
            this.intervalId = setInterval(() => {
                this.frameIndex = (this.frameIndex + 1) % SPINNER_FRAMES.length
                this.render()
            }, SPINNER_INTERVAL)
        }
    }

    /**
     * Clear spinner output and restore cursor.
     */
    clear() {
        if (this.intervalId) {
            clearInterval(this.intervalId)
            this.intervalId = null
        }

        if (isProgressInteractive && this.previousLineCount > 0) {
            stderr.write(cursor.up(this.previousLineCount))

            for (let i = 0; i < this.previousLineCount; i++) {
                stderr.write(`\r${cursor.clearLine}\n`)
            }

            stderr.write(cursor.up(this.previousLineCount))
            stderr.write(cursor.show)
        }

        this.previousLineCount = 0
    }

    /**
     * Update a running task's label in place — the spinner keeps spinning, only
     * the text changes. For showing phase progress on a single long task (e.g.
     * "opening page" → "submitting form") without stacking a line per phase.
     *
     * @param taskId - task identifier
     * @param text - the new running label
     */
    setText(taskId: string, text: string) {
        const task = this.tasks.get(taskId)

        if (task) {
            task.text = text

            if (!isProgressInteractive && task.status === 'running') {
                /* No in-place redraw off a TTY; emit the phase as its own line. */
                console.error(`${'  '.repeat(this.indent)}[RUNNING] ${text}`)
            }
        }
    }

    /**
     * Update the status of a task.
     *
     * @param taskId - task identifier
     * @param status - new status
     * @param finalText - override display text for terminal states
     */
    updateTask(
        taskId: string,
        status: 'running' | 'success' | 'error' | 'cancelled',
        finalText?: string,
    ) {
        const task = this.tasks.get(taskId)

        if (task) {
            task.status = status

            if (finalText) {
                task.finalText = finalText
            }

            if (!isProgressInteractive) {
                this.renderNonInteractive(taskId, task)
            }
        }
    }

    /**
     * Stop the spinner and finalize output.
     */
    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId)
            this.intervalId = null
        }

        if (isProgressInteractive) {
            this.render()
            stderr.write(cursor.show)
        } else {
            this.tasks.forEach((task, taskId) => {
                if (task.status !== 'pending') {
                    this.renderNonInteractive(taskId, task)
                }
            })
        }
    }

    /**
     * Render a task status line in non-interactive mode (CI, piped output).
     *
     * @param taskId - unique task identifier
     * @param task - current task state
     */
    private renderNonInteractive(taskId: string, task: TaskState) {
        const key = `${taskId}-${task.status}`

        if (this.printedTasks.has(key)) {
            return
        }

        this.printedTasks.add(key)

        const indentStr = '  '.repeat(this.indent)
        let line = ''

        switch (task.status) {
            case 'running': {
                line = `${indentStr}[RUNNING] ${task.text}`
                break
            }

            case 'success': {
                line = `${indentStr}[SUCCESS] ${task.finalText || task.text}`
                break
            }

            case 'error': {
                line = `${indentStr}[ERROR] Failed: ${task.text}`
                break
            }

            case 'cancelled': {
                line = `${indentStr}[CANCELLED] ${task.finalText || task.text}`
                break
            }
        }

        console.error(line)
    }

    /**
     * Redraw all task lines in-place using ANSI cursor movement.
     */
    private render() {
        if (this.previousLineCount > 0) {
            stderr.write(cursor.up(this.previousLineCount))
        }

        const spinner = SPINNER_FRAMES[this.frameIndex]
        const indentStr = '  '.repeat(this.indent)

        const visibleTasks = [...this.tasks.values()].filter(task => task.status !== 'pending')

        for (const task of visibleTasks) {
            stderr.write(`\r${cursor.clearLine}`)

            let line = ''

            switch (task.status) {
                case 'running': {
                    line = `${indentStr}${blue(spinner)} ${task.text}`
                    break
                }

                case 'success': {
                    line = `${indentStr}${green(CHECK_MARK)} ${task.finalText || task.text}`
                    break
                }

                case 'error': {
                    line = `${indentStr}${red(CROSS_MARK)} Failed: ${task.text}`
                    break
                }

                case 'cancelled': {
                    line = `${indentStr}${gray(CANCEL_MARK)} Cancelled: ${task.finalText || task.text}`
                    break
                }
            }

            console.error(line)
        }

        this.previousLineCount = visibleTasks.length
        this.renderCount++
    }
}

/**
 * Format an elapsed duration as the dim bracketed suffix of a spinner task
 * line (e.g. `[1.24s]`).
 *
 * @param ms - elapsed time in milliseconds
 * @returns the styled duration string
 */
export function formatDuration(ms: number): string {
    const duration = ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(2)}s`

    return dim(`[${duration}]`)
}
