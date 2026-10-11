export type Outcome =
    | 'success'
    | 'configuration_error'
    | 'model_error'
    | 'incomplete'
    | 'protocol_error'
    | 'timeout'
    | 'cancelled'
    | 'runtime_error'

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
    /** Last assistant errorMessage, if present. */
    modelError: string | null
    /** First framing or event-shape failure, if any. */
    protocolError: string | null
    /** Number of scheduled assistant and summarization retries. */
    retryCount: number
    /** Number of compaction_start records observed. */
    compactionCount: number
    /** Number of failed tool_execution_end records. */
    toolErrorCount: number
}
