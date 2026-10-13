import { styleText } from 'node:util'

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

    /**
     * Make one style.
     * @param format - a node:util style name
     * @returns the style
     */
    function make(format: Parameters<typeof styleText>[0]): (text: string) => string {
        /* Bun's styleText does not check the stream itself; wantsColor already has. */
        return on ? text => styleText(format, text, { validateStream: false }) : text => text
    }

    const green = make('green')
    const red = make('red')

    return {
        on,
        bold: make('bold'),
        dim: make('dim'),
        green,
        red,
        yellow: make('yellow'),
        cyan: make('cyan'),
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
