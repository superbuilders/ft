import { adapterFor } from './adapters'

import type { ChatRequest } from './adapters/types'

/** Request headers the local hop must not copy, since an adapter may change the body. */
const REQUEST_HOP_HEADERS = ['host', 'content-length']

/** Bun's fetch has already decompressed the body these headers describe. */
const RESPONSE_HOP_HEADERS = ['content-encoding', 'content-length']

/**
 * Copy a gateway response without the headers that no longer describe its body.
 * @param response - the gateway's response, already decompressed by fetch
 * @returns the same status and stream with accurate headers
 */
function relay(response: Response): Response {
    const headers = new Headers(response.headers)

    for (const name of RESPONSE_HOP_HEADERS) {
        headers.delete(name)
    }

    return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
    })
}

/**
 * Serve a loopback gateway that forwards Pi's requests and applies each model's adapter.
 * @param upstream - configured gateway root, without /v1
 * @returns the local root Pi should use instead, and a stop function
 */
export function serveGateway(upstream: string): { url: string; stop: () => Promise<void> } {
    const server = Bun.serve({
        hostname: '127.0.0.1',
        port: 0,
        async fetch(request) {
            const url = new URL(request.url)
            const headers = new Headers(request.headers)

            for (const name of REQUEST_HOP_HEADERS) {
                headers.delete(name)
            }

            let body: string | null = request.method === 'POST' ? await request.text() : null
            let adapter

            if (body && url.pathname.endsWith('/chat/completions')) {
                const chat = JSON.parse(body) as ChatRequest

                adapter = adapterFor(chat.model)

                if (adapter?.request) {
                    body = JSON.stringify(adapter.request(chat))
                }
            }

            const response = relay(
                await fetch(`${upstream}${url.pathname}${url.search}`, {
                    method: request.method,
                    headers,
                    body,
                    signal: request.signal,
                }),
            )

            if (!response.ok || !adapter?.response) {
                return response
            }

            return adapter.response(response)
        },
        error() {
            return new Response('ft could not reach the gateway', { status: 502 })
        },
    })

    return { url: `http://127.0.0.1:${server.port}`, stop: () => server.stop(true) }
}
