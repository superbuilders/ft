import { runCommand } from '../../system/process/subprocess'
import { NOT_HEADER_SAFE } from './patterns'

import type { KeySource } from '../../models/types'

/**
 * Refuse a credential no HTTP header can carry, or one that is really a pi `!command`, without
 * echoing it: a header error would print it.
 * @param key - trimmed credential
 * @param origin - where it came from, for the message
 * @returns the credential
 */
function checked(key: string, origin: string): string {
    if (NOT_HEADER_SAFE.test(key)) {
        throw new Error(
            `${origin} contains a line break or another character a request header cannot carry`,
        )
    }

    if (key.startsWith('!')) {
        throw new Error(
            `${origin} looks like a pi shell command (use {"command": ["sh", "-c", "…"]} as the key instead)`,
        )
    }

    return key
}

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
            throw new Error(`key environment variable ${source.env} is empty or unset`)
        }

        return checked(key, `key environment variable ${source.env}`)
    }

    const result = await runCommand(source.command, root, { signal, stderr: 'ignore' })

    if (result.exitCode !== 0) {
        throw new Error(`key command failed (exit ${result.exitCode})`)
    }

    /* Stdout carries the credential; never forward it. Stderr is discarded unread. */
    const key = result.stdout.toString('utf8').trim()

    if (!key) {
        throw new Error('key command printed nothing')
    }

    return checked(key, 'key command output')
}
