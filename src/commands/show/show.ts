import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { storyOf } from '../../pi/events/story'
import { runsFolder } from '../../project/config/config'
import { RUN_FILES } from '../../project/runs/constants'
import {
    ago,
    displayPath,
    formatDuration,
    headline,
    jsonLine,
    renderReport,
} from '../../project/runs/render'
import { findRuns, readKept, stateOf } from '../../project/runs/store'
import { commandName } from '../../system/process/self'
import { styleFor } from '../../system/terminal/style'

import type { Step } from '../../pi/events/story'
import type { Style } from '../../system/terminal/types'

/**
 * Lay out one step with its time and note: the tool name bold, the time dim, a failed step red.
 * @param step - one step
 * @param style - output styles
 * @returns a padded line
 */
function stepLine(step: Step, style: Style): string {
    const time = step.at === null ? '' : formatDuration(step.at)
    const split = step.text.indexOf(': ')
    const text =
        split > 0
            ? `${style.bold(step.text.slice(0, split))}${step.text.slice(split)}`
            : style.bold(step.text)
    const failed = step.note === 'failed'
    const note = step.note ? `  ${(failed ? style.red : style.dim)(`(${step.note})`)}` : ''

    return `  ${style.dim(time.padStart(7))}  ${failed ? style.red(step.text) : text}${note}`
}

/**
 * Tell the whole story of one run: the brief, every step the model took, and how it ended.
 * @param id - run id or unambiguous prefix
 * @param options - command options
 * @param options.json - print the status as JSON
 * @returns completion
 */
export async function show(id: string, options: { json?: boolean }): Promise<void> {
    const [status] = await findRuns(runsFolder(), [id])

    if (!status) {
        return
    }

    const state = stateOf(status)

    if (options.json) {
        process.stdout.write(jsonLine(status, state))

        return
    }

    const events = await readFile(join(status.dir, RUN_FILES.events), 'utf8').catch(() => '')
    const steps = storyOf(events)
    const style = styleFor(process.stdout)
    const lines = [
        `${style.bold('Brief:')} ${status.title} ${style.dim(`(full text in ${displayPath(join(status.dir, RUN_FILES.brief))})`)}`,
        style.dim(
            `Started ${ago(status.startedAt)} in ${displayPath(status.cwd) || '.'} with the ${status.profile} profile`,
        ),
        '',
        ...(steps.length > 0
            ? [style.bold('Steps:'), ...steps.map(step => stepLine(step, style)), '']
            : []),
    ]

    if (state === 'running') {
        lines.push(
            headline(status, state, style),
            `Now: ${status.activity ?? 'starting'}`,
            `Run ${style.cyan(`${commandName()} watch ${status.id}`)} to wait for its report`,
        )
        process.stdout.write(`${lines.join('\n')}\n`)

        return
    }

    const [text, stderr] = await Promise.all([
        readKept(status),
        state === 'success'
            ? ''
            : readFile(join(status.dir, RUN_FILES.stderr), 'utf8').catch(() => ''),
    ])

    if (stderr.trim()) {
        lines.push(
            style.bold('Pi stderr (last lines):'),
            ...stderr
                .trimEnd()
                .split('\n')
                .slice(-10)
                .map(line => style.dim(`  ${line}`)),
            '',
        )
    }

    process.stdout.write(`${lines.join('\n')}\n${renderReport(status, state, text, true, style)}`)
}
