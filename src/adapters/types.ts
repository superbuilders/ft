/**
 * The OpenAI chat-completions request body Pi sends, read only as far as adapters need.
 */
export interface ChatRequest {
    /** Exact catalog model id; selects the adapter. */
    model: string
    /** Every other request field, forwarded unchanged unless an adapter rewrites it. */
    [field: string]: unknown
}

/**
 * Makes one model's gateway traffic look like the streamed OpenAI protocol Pi 1.1.0
 * reads. ft's local gateway applies it to every request for one of its models.
 */
export interface Adapter {
    /** Catalog model ids this adapter serves; a model has at most one adapter. */
    models: readonly string[]
    /** Rewrite the request body before it reaches the gateway. */
    request?: (body: ChatRequest) => ChatRequest
    /** Rewrite a successful gateway response before Pi reads it. */
    response?: (response: Response) => Promise<Response>
}

/**
 * The parts of a non-streamed chat completion that Sonar adds or Pi needs.
 */
export interface Completion {
    /** Provider completion id, repeated on every replayed chunk. */
    id?: string
    /** Unix seconds, repeated on every replayed chunk. */
    created?: number
    /** Model id the gateway answered with. */
    model?: string
    /** One choice; Sonar never returns more. */
    choices?: { message?: { content?: unknown }; finish_reason?: string | null }[]
    /** Source URLs, or source objects, numbered as the answer's [n] markers. */
    citations?: unknown
    /** Search hits with titles and snippets. */
    search_results?: unknown
    /** Token usage, passed to Pi on the final chunk. */
    usage?: unknown
}
