import type { Progress } from '../../project/runs/types'

/**
 * What Pi's events and exit can decide; the run adds configuration, deadline and cancellation outcomes.
 */
export type Verdict = 'success' | 'model_error' | 'incomplete' | 'protocol_error' | 'runtime_error'

/**
 * Mutable protocol evidence; only authoritative messages supply answer text.
 */
export interface JudgeState {
    /** Whether the JSON session header has been parsed. */
    header: boolean
    /** Whether an agent_start record has been observed. */
    started: boolean
    /** Whether the agent finished automatic recovery work. */
    settled: boolean
    /** Pi agent_settled abort indicator. */
    aborted: boolean
    /** Last authoritative assistant stop reason, if observed. */
    stopReason: string | null
    /** All text blocks of the last authoritative assistant, in order. */
    text: string
    /** The last assistant text that said anything; a failed run keeps it as a partial answer. */
    lastText: string
    /** Last assistant errorMessage, if present. */
    modelError: string | null
    /** Whether Pi's own detector reads the last assistant message as a context-window overflow. */
    contextOverflow: boolean
    /** First framing or event-shape failure, if any. */
    protocolError: string | null
    /** Number of scheduled assistant and summarization retries. */
    retryCount: number
    /** Number of compaction_start records observed. */
    compactionCount: number
    /** Number of failed tool_execution_end records. */
    toolErrorCount: number
    /** What a person watching the run wants to know: tokens, tools, files, current step. */
    progress: Progress
    /** Paths of edit and write calls still running, by tool call id. */
    pending: Map<string, string>
}
