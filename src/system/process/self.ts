import { resolve } from 'node:path'

/**
 * The argv that runs this same ft again, in both compiled and source execution modes.
 * @returns absolute command argv
 */
export function selfCommand(): string[] {
    return process.argv[1]?.endsWith('.ts')
        ? [process.execPath, resolve(process.argv[1])]
        : [process.execPath]
}
