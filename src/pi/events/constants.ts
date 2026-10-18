/** The id ft gives the prompt command that carries the brief, so its response is told apart. */
export const BRIEF_COMMAND_ID = 'brief'

/**
 * Events left out of a run's events.jsonl. Pi repeats each message and tool result in them, and
 * message_end and tool_execution_end already carry the same content once; streamed deltas end in a message_end.
 */
export const UNRECORDED_EVENTS: readonly string[] = [
    'message_start',
    'message_update',
    'turn_end',
    'agent_end',
]

/** How Pi answers a prompt it will run: at once, or after the work already in hand. */
export const ACCEPTED_DISPOSITIONS: readonly string[] = ['started', 'queued']

/** Longest one-line activity description kept in status. */
export const ACTIVITY_MAX = 100

/** Pi tools whose `path` argument names a file the run changed. */
export const FILE_TOOLS: readonly string[] = ['edit', 'write']
