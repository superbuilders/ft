/**
 * The OpenAI chat-completions request body Pi sends, read only as far as adapters need.
 */
export interface ChatRequest {
    /** The provider's model id. */
    model: string
    /** Every other request field, forwarded unchanged unless an adapter rewrites it. */
    [field: string]: unknown
}

/**
 * Makes one model's traffic look like the streamed OpenAI protocol Pi 1.1.0 reads. A model entry
 * names it with `adapter`, and ft's local gateway then applies it to every request for that model.
 */
export interface Adapter {
    /** Whether the model can call tools; a tool-free model's runs start Pi with none. */
    tools: boolean
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
