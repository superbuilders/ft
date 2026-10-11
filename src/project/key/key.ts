import { runCommand } from '../../system/process/subprocess'

import type { KeySource } from '../../models/types'

/**
 * Resolve a credential without ever writing it to diagnostic output.
 * @param source - the provider's key source
 * @param root - project root, the key command's working directory
 * @param signal - cancellation for a running command
 * @returns trimmed credential held only in memory
 */
export async function getKey(
    source: KeySource,
    root: string,
    signal?: AbortSignal,
): Promise<string> {
    if ('env' in source) {
        const key = process.env[source.env]?.trim()

        if (!key) {
            throw new Error(`Key environment variable ${source.env} is empty or unset`)
        }

        return key
    }

    const result = await runCommand(source.command, root, signal)

    if (result.exitCode !== 0) {
        throw new Error(`Key command failed (exit ${result.exitCode})`)
    }

    /* Command stderr may contain the credential too; never forward either captured pipe. */
    const key = result.stdout.toString('utf8').trim()

    if (!key) {
        throw new Error('Key command returned empty stdout')
    }

    return key
}
