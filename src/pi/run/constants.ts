import type { RunProfile } from './types'

/** A harness closing its terminal sends SIGHUP; treat it like Ctrl-C so Pi and its tools are stopped. */
export const CANCEL_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const

/** The run's steering socket, in its private scratch folder beside the key socket. */
export const CONTROL_SOCKET = 'control.sock'

/** Longest steering message accepted, in characters; a longer instruction belongs in a new brief. */
export const STEER_MAX_CHARS = 20_000

/** Why a run just starting refuses a steer: Pi has not taken its brief yet. */
export const STILL_STARTING = 'the run is still starting; try again in a few seconds'

/** Pi's command id for one steer, so its response is matched to the steer. */
export const STEER_ID_PREFIX = 'steer-'

/**
 * What each --profile gives the delegate: the Pi tools it may use (a tool-free model gets none
 * whatever the profile), and standing instructions so briefs carry only the task. A brief that
 * says otherwise wins.
 */
export const RUN_PROFILES: Record<string, RunProfile> = {
    read: {
        tools: ['read', 'grep', 'find', 'ls', 'bash'],
        preamble: `# How this run works

You are a delegate. Another agent wrote the brief below and will read your final message, then act on it; nobody can answer questions while you work. That agent may send you messages while you work; they arrive as user messages, and where one conflicts with the brief, the message wins. Your last message is your answer, so if a message arrives after you have answered, answer again in full. Investigate with the tools you have, and say plainly what you could not determine.

Do not change files: this run is for reading and reporting. Your final message is your whole report. Lead with the answer, then the evidence (file paths with line numbers, commands and their output), then anything left open. If the brief asks for something else, the brief wins.`,
    },
    write: {
        tools: ['read', 'grep', 'find', 'ls', 'bash', 'edit', 'write'],
        preamble: `# How this run works

You are a delegate. Another agent wrote the brief below, will review your changes and will commit them; nobody can answer questions while you work. That agent may send you messages while you work; they arrive as user messages, and where one conflicts with the brief, the message wins. Your last message is your answer, so if a message arrives after you have answered, answer again in full. Investigate with the tools you have, and say plainly what you could not determine.

Make the change the brief asks for and nothing else: no unrelated refactors, renames or cleanup. Run the checks this repository's instructions name, and fix what they surface. Do not stage, commit or push. Your final message is your whole report: what changed and why, the files you touched, the check results, and anything left open or needing a decision. If the brief asks for something else, the brief wins.`,
    },
}
