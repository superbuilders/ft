/**
 * What a key check found: accepted, rejected with the status the provider gave, or not checked
 * and why.
 */
export type ProbeResult =
    | { verdict: 'accepted' }
    | { verdict: 'rejected'; status: number }
    | { verdict: 'unchecked'; reason: string }

/**
 * The model-list request a key check sends.
 */
export interface ListRequest {
    /** Absolute URL of the provider's model list. */
    url: string
    /** Headers carrying the key the way the provider expects it. */
    headers: Record<string, string>
}
