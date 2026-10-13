import { basename, resolve } from 'node:path'

import { RUNTIMES } from './constants'

/**
 * The argv that runs this same ft again, in both compiled and source execution modes.
 * @returns absolute command argv
 */
export function selfCommand(): string[] {
    return process.argv[1]?.endsWith('.ts')
        ? [process.execPath, resolve(process.argv[1])]
        : [process.execPath]
}

/**
 * The name this ft was run as, for the commands its hints suggest: `ft` for an installed ft (the
 * launcher starts a runner named `ft`), the file's own name for a build installed beside it, such
 * as `ft-dev`.
 * @returns the command name
 */
export function commandName(): string {
    const name = basename(process.execPath)

    /* From source, or under a test runner, the executable is the runtime itself. */
    return (RUNTIMES as readonly string[]).includes(name) ? 'ft' : name
}
