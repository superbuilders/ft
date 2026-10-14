/** The id ft gives the prompt command that carries the brief, so its response is told apart. */
export const BRIEF_COMMAND_ID = 'brief'

/** How Pi answers a prompt it will run: at once, or after the work already in hand. */
export const ACCEPTED_DISPOSITIONS: readonly string[] = ['started', 'queued']

/** Longest one-line activity description kept in status. */
export const ACTIVITY_MAX = 100

/** Pi tools whose `path` argument names a file the run changed. */
export const FILE_TOOLS: readonly string[] = ['edit', 'write']
