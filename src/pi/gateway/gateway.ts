import type { Adapter, ChatRequest } from './adapters/types'

/** Request headers the local hop must not copy, since an adapter may change the body. */
const REQUEST_HOP_HEADERS = ['host', 'content-length']

/** Bun's fetch has already decompressed the body these headers describe. */
const RESPONSE_HOP_HEADERS = ['content-encoding', 'content-length']

/**
 * Copy a gateway response without the headers that no longer describe its body.
 * The body goes through a pipe the stop signal can cut: when Pi stops reading at [DONE] while the
 * upstream stream stays open, Bun's server stop never returns for a body handed over directly.
 * @param response - the gateway's response, already decompressed by fetch
 * @param signal - cut the body when the gateway stops
 * @returns the same status and stream with accurate headers
 */
function relay(response: Response, signal: AbortSignal): Response {
    const headers = new Headers(response.headers)

    for (const name of RESPONSE_HOP_HEADERS) {
        headers.delete(name)
    }

    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>()

    response.body?.pipeTo(writable, { signal }).catch(() => {
        /* A cut or failed upstream ends the relayed body; Pi judges the truncated stream. */
    })

    return new Response(response.body ? readable : null, {
        status: response.status,
        statusText: response.statusText,
        headers,
    })
}

/**
 * Serve a loopback gateway for one run that forwards Pi's requests through the run model's adapter.
 * @param upstream - configured gateway root, without /v1
 * @param adapter - the run model's adapter, if it has one
 * @returns the local root Pi should use instead, and a stop function
 */
export function serveGateway(
    upstream: string,
    adapter?: Adapter,
): { url: string; stop: () => Promise<void> } {
    const stopping = new AbortController()
    const server = Bun.serve({
        hostname: '127.0.0.1',
        port: 0,

        /*
         * A model can think silently for longer than Bun's 10-second default; the run deadline bounds it instead.
         */
        idleTimeout: 0,

        async fetch(request) {
            const url = new URL(request.url)
            const headers = new Headers(request.headers)

            for (const name of REQUEST_HOP_HEADERS) {
                headers.delete(name)
            }

            const chat = url.pathname.endsWith('/chat/completions')
            let body: string | null = request.method === 'POST' ? await request.text() : null

            if (body && chat && adapter?.request) {
                body = JSON.stringify(adapter.request(JSON.parse(body) as ChatRequest))
            }

            let response = await fetch(`${upstream}${url.pathname}${url.search}`, {
                method: request.method,
                headers,
                body,
                signal: AbortSignal.any([request.signal, stopping.signal]),
            })

            if (chat && response.ok && adapter?.response) {
                response = await adapter.response(response)
            }

            return relay(response, stopping.signal)
        },
        error() {
            return new Response('ft could not reach the gateway', { status: 502 })
        },
    })

    return {
        url: `http://127.0.0.1:${server.port}`,
        stop: () => {
            stopping.abort()

            return server.stop(true)
        },
    }
}
