import { createColors } from 'colorette'

import type { Style } from './types'

/**
 * Whether a stream should get color, following no-color.org: FORCE_COLOR turns it on, NO_COLOR or
 * TERM=dumb off, and otherwise only a terminal gets it. Pipes, files and agents always get plain
 * text, byte for byte, so nothing that parses ft's output ever sees styling.
 * @param stream - the stream the text is written to
 * @param stream.isTTY - whether it is a terminal
 * @returns true when styling is wanted
 */
function wantsColor(stream: { isTTY?: boolean }): boolean {
    const force = process.env.FORCE_COLOR

    if (force !== undefined && force !== '' && force !== '0') {
        return true
    }

    if (process.env.NO_COLOR || process.env.TERM === 'dumb') {
        return false
    }

    return stream.isTTY === true
}

/**
 * Text styles for one stream: real styles on a terminal, the text unchanged everywhere else.
 * @param stream - the stream the text is written to
 * @param stream.isTTY - whether it is a terminal
 * @returns the stream's styles
 */
export function styleFor(stream: { isTTY?: boolean }): Style {
    const on = wantsColor(stream)
    /* colorette decides color for stdout alone; ft decides per stream, so it passes the answer. */
    const { bold, dim, green, red, yellow, cyan } = createColors({ useColor: on })

    return {
        on,
        bold,
        dim,
        green,
        red,
        yellow,
        cyan,
        mark: ok => {
            if (!on) {
                return ''
            }

            return ok ? `${green('✔')} ` : `${red('✗')} `
        },
    }
}

/** Styles that change nothing, for text that is never shown on a terminal. */
export const PLAIN: Style = styleFor({ isTTY: false })
