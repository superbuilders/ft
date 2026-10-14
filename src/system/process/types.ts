/**
 * How runCommand runs a command.
 */
export interface CommandOptions {
    /** Cancellation; aborting kills the command. */
    signal?: AbortSignal
    /** `ignore` discards stderr unread, for callers that never use it (default `pipe`). */
    stderr?: 'pipe' | 'ignore'
}

/**
 * A finished subprocess. Callers decide what may be shown: the key command's
 * pipes can carry the credential, so nothing here is logged.
 */
export interface CommandResult {
    /** Everything the command wrote to stdout, as raw bytes. */
    stdout: Buffer
    /** Everything the command wrote to stderr, as raw bytes (empty when ignored). */
    stderr: Buffer
    /** The command's exit status; nonzero means it failed. */
    exitCode: number
}
