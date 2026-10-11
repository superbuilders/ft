import { runCommand } from '../../system/process/subprocess'

import type { ResolvedConfig } from '../config/types'

/**
 * Resolve the key without ever writing it to diagnostic output.
 * @param config - key source and project root
 * @param signal - cancellation for a running command
 * @returns trimmed credential held only in memory
 */
export async function getKey(config: ResolvedConfig, signal?: AbortSignal): Promise<string> {
    const source = config.config.apiKey

    if ('env' in source) {
        const key = process.env[source.env]?.trim()

        if (!key) {
            throw new Error(`Key environment variable ${source.env} is empty or unset`)
        }

        return key
    }

    const result = await runCommand(source.command, config.root, signal)

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
