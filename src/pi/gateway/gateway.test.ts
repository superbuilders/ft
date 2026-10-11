import { afterEach, describe, expect, it } from 'vitest'

import { adapterFor } from './adapters'
import { serveGateway } from './gateway'

const servers: { stop: () => Promise<void> }[] = []

/**
 * Start an upstream that records each request and answers with one JSON completion.
 * @returns its root URL and the requests it saw
 */
function upstream(): { url: string; seen: { path: string; auth: string | null; body: unknown }[] } {
    const seen: { path: string; auth: string | null; body: unknown }[] = []
    const server = Bun.serve({
        hostname: '127.0.0.1',
        port: 0,
        async fetch(request) {
            seen.push({
                path: new URL(request.url).pathname,
                auth: request.headers.get('authorization'),
                body: await request.json(),
            })

            return Response.json({
                choices: [{ message: { content: 'Answer' }, finish_reason: 'stop' }],
                citations: ['https://example.test'],
            })
        },
    })

    servers.push({ stop: () => server.stop(true) })

    return { url: `http://127.0.0.1:${server.port}`, seen }
}

/**
 * Send one chat request for a model through a fresh gateway.
 * @param model - catalog model id
 * @returns the reply and what the upstream received
 */
async function chat(model: string) {
    const origin = upstream()
    const gateway = serveGateway(origin.url, adapterFor(model))

    servers.push(gateway)

    const response = await fetch(`${gateway.url}/v1/chat/completions`, {
        method: 'POST',
        headers: { authorization: 'Bearer test', 'content-type': 'application/json' },
        body: JSON.stringify({ model, stream: true, tools: [{ type: 'function' }] }),
    })

    return { response, seen: origin.seen }
}

afterEach(async () => {
    await Promise.all(servers.splice(0).map(server => server.stop()))
})

describe('local gateway', () => {
    it('forwards a model without an adapter unchanged', async () => {
        const { response, seen } = await chat('gpt-6.1-sol')

        expect(seen).toEqual([
            {
                path: '/v1/chat/completions',
                auth: 'Bearer test',
                body: { model: 'gpt-6.1-sol', stream: true, tools: [{ type: 'function' }] },
            },
        ])
        expect(response.headers.get('content-type')).toContain('application/json')
    })

    it("applies the model's adapter to the request and the response", async () => {
        const { response, seen } = await chat('sonar-pro')

        expect(seen[0]?.body).toEqual({ model: 'sonar-pro', stream: true })
        expect(response.headers.get('content-type')).toBe('text/event-stream')
        expect(await response.text()).toContain('## Citations')
    })

    it('answers 502 when the gateway is unreachable', async () => {
        const gateway = serveGateway('http://127.0.0.1:9')

        servers.push(gateway)

        const response = await fetch(`${gateway.url}/v1/chat/completions`, {
            method: 'POST',
            body: JSON.stringify({ model: 'gpt-6.1-sol' }),
        })

        expect(response.status).toBe(502)
    })

    it('stops while an upstream stream is still open after the reader has left', async () => {
        const origin = Bun.serve({
            hostname: '127.0.0.1',
            port: 0,
            fetch: () =>
                new Response(
                    new ReadableStream({
                        start(controller) {
                            controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'))
                        },
                    }),
                    { headers: { 'content-type': 'text/event-stream' } },
                ),
        })

        servers.push({ stop: () => origin.stop(true) })

        const gateway = serveGateway(`http://127.0.0.1:${origin.port}`)
        const client = `const response = await fetch(${JSON.stringify(`${gateway.url}/v1/chat/completions`)}, { method: 'POST', body: '{}' }); await response.body.getReader().read(); process.exit(0)`

        /* A reader in another process that exits, as Pi does, is what left Bun's stop pending. */
        expect(await Bun.spawn([process.execPath, '-e', client]).exited).toBe(0)

        const stopped = await Promise.race([
            gateway.stop().then(() => true),
            Bun.sleep(2000).then(() => false),
        ])

        expect(stopped).toBe(true)
    })
})
