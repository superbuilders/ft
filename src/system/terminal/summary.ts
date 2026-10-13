import { BACKTICKED } from './patterns'

import type { Style, Summary } from './types'

/**
 * Lay out what a setup command did, in the installer's shape: a ✔ headline, label rows between
 * rules, then notes and numbered next steps. On a terminal the block is indented and ruled, and a
 * command written in backticks (in a row's value, a note or a step) is colored; elsewhere the same
 * lines print plain, backticks dropped.
 * @param summary - what to print
 * @param style - the stream's styles
 * @returns text ending in a newline
 */
export function renderSummary(summary: Summary, style: Style): string {
    const width = Math.max(0, ...summary.rows.map(([label]) => label.length)) + 2

    /**
     * Color the backticked commands in one piece of text.
     * @param text - a value, note or step
     * @returns the text, backticks dropped
     */
    function commands(text: string): string {
        return text.replace(BACKTICKED, (_, command: string) => style.cyan(command))
    }

    const rows = summary.rows.map(
        ([label, value]) => `${style.bold(label.padEnd(width))}${commands(value)}`,
    )
    const notes = (summary.notes ?? []).map(note => style.dim(commands(note)))
    const steps = summary.steps ?? []
    const next =
        steps.length > 0
            ? [
                  '',
                  style.bold('Next:'),
                  ...steps.map((step, index) => `  ${index + 1}. ${commands(step)}`),
              ]
            : []

    if (!style.on) {
        return [summary.done, ...rows, ...notes, ...next].map(line => `${line}\n`).join('')
    }

    /* The rule spans the widest line, as printed without styling, up to the terminal's width. */
    const plain = [
        summary.done,
        ...summary.rows.map(([label, value]) => `${label.padEnd(width)}${value}`),
    ]
    const rule = style.dim('─'.repeat(Math.min(Math.max(...plain.map(line => line.length)), 76)))
    const block = [
        `${style.mark(true)}${style.bold(summary.done)}`,
        rule,
        ...rows,
        ...(rows.length > 0 ? [rule] : []),
        ...notes,
        ...next,
    ]

    return `\n${block.map(line => (line ? `  ${line}` : '')).join('\n')}\n\n`
}
