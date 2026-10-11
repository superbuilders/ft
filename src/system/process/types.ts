/**
 * A finished subprocess. Callers decide what may be shown: the key command's
 * pipes can carry the credential, so nothing here is logged.
 */
export interface CommandResult {
    /** Everything the command wrote to stdout, as raw bytes. */
    stdout: Buffer
    /** Everything the command wrote to stderr, as raw bytes. */
    stderr: Buffer
    /** The command's exit status; nonzero means it failed. */
    exitCode: number
}
