import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { storyOf } from '../../pi/events/story'
import { projectRoot } from '../../project/config/config'
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

import type { Step } from '../../pi/events/story'

/**
 * Lay out one step with its time and note.
 * @param step - one step
 * @returns a padded line
 */
function stepLine(step: Step): string {
    const time = step.at === null ? '' : formatDuration(step.at)

    return `  ${time.padStart(7)}  ${step.text}${step.note ? `  (${step.note})` : ''}`
}

/**
 * Tell the whole story of one run: the brief, every step the model took, and how it ended.
 * @param id - run id or unambiguous prefix
 * @param options - command options
 * @param options.json - print the status as JSON
 * @returns completion
 */
export async function show(id: string, options: { json?: boolean }): Promise<void> {
    const [status] = await findRuns(projectRoot(), [id])

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
    const lines = [
        `Brief: ${status.title} (full text in ${displayPath(join(status.dir, RUN_FILES.brief))})`,
        `Started ${ago(status.startedAt)} in ${displayPath(status.cwd) || '.'} with the ${status.profile} profile`,
        '',
        ...(steps.length > 0 ? ['Steps:', ...steps.map(stepLine), ''] : []),
    ]

    if (state === 'running') {
        lines.push(
            headline(status, state),
            `Now: ${status.activity ?? 'starting'}`,
            `ft watch ${status.id} collects it when it finishes`,
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
            'Pi stderr (last lines):',
            ...stderr
                .trimEnd()
                .split('\n')
                .slice(-10)
                .map(line => `  ${line}`),
            '',
        )
    }

    process.stdout.write(`${lines.join('\n')}\n${renderReport(status, state, text, false)}`)
}
