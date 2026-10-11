/** A harness closing its terminal sends SIGHUP; treat it like Ctrl-C so Pi and its tools are stopped. */
export const CANCEL_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const

/** A running run rewrites its status at most this often, so readers see it move without a write per token. */
export const STATUS_INTERVAL_MS = 1000

/** Longest deadline the timer can hold, in seconds. */
export const DEADLINE_MAX_SECONDS = 2_147_483

/**
 * Standing instructions for the delegate, by profile, so briefs carry only the task. A brief that
 * says otherwise wins.
 */
export const DELEGATE_PREAMBLE: Record<string, string> = {
    read: `# How this run works

You are a delegate. Another agent wrote the brief below and will read your final message, then act on it; nobody can answer questions while you work. Investigate with the tools you have, and say plainly what you could not determine.

Do not change files: this run is for reading and reporting. Your final message is your whole report. Lead with the answer, then the evidence (file paths with line numbers, commands and their output), then anything left open. If the brief asks for something else, the brief wins.`,
    write: `# How this run works

You are a delegate. Another agent wrote the brief below, will review your changes and will commit them; nobody can answer questions while you work. Investigate with the tools you have, and say plainly what you could not determine.

Make the change the brief asks for and nothing else: no unrelated refactors, renames or cleanup. Run the checks this repository's instructions name, and fix what they surface. Do not stage, commit or push. Your final message is your whole report: what changed and why, the files you touched, the check results, and anything left open or needing a decision. If the brief asks for something else, the brief wins.`,
}

/** How long `ft start` waits for the detached run to report its process before handing back. */
export const START_CONFIRM_MS = 10_000

/** How often `ft start` checks for that report. */
export const START_POLL_MS = 50
