import { styleFor } from '../../system/terminal/style'

import type { HelpConfiguration } from 'commander'

/* Commander drops these styles itself wherever help is not printed to a color terminal. */
const help = styleFor({ isTTY: true })

/** Help styles: section titles bold, commands and options in the color of a command to run. */
export const HELP_STYLES: HelpConfiguration = {
    styleTitle: help.bold,
    styleCommandText: help.cyan,
    styleSubcommandText: help.cyan,
    styleOptionText: help.cyan,
}

/**
 * Print a failure the way every ft command does: one `ft:` line on stderr, red on a terminal.
 * @param error - what went wrong
 */
export function printFailure(error: unknown): void {
    const message = error instanceof Error ? error.message : 'failed'

    process.stderr.write(`${styleFor(process.stderr).red(`ft: ${message}`)}\n`)
}
