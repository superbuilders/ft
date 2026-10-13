/**
 * Terminal affordances for scripts, ported from the arcade's scripts/lib/ansi.ts: cursor control
 * and whether the spinner can repaint. Colors come from colorette, which already turns itself off
 * where the output cannot show them; repainting is a separate question, which CI, `dumb`
 * terminals and pipes cannot answer yes to.
 */

/** Whether the process is at a real, repaintable terminal; CI and `dumb` terminals are not. */
const repaintable = !process.env.CI && process.env.TERM !== 'dumb'

export const cursor = {
    hide: '\x1B[?25l',
    show: '\x1B[?25h',
    up: (lines: number) => `\x1B[${lines}A`,
    clearLine: '\x1B[K',
} as const

/** The spinner renders to stderr, so it animates only where stderr is a repaintable terminal. */
export const isProgressInteractive = repaintable && process.stderr.isTTY
