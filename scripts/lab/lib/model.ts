import { ANSWER, DUMMY_KEY } from './constants'

import type { ModelRequest } from './types'

/**
 * Start the original loopback OpenAI fixture with deterministic cancellation readiness.
 * @param scenario - scripted response behavior
 * @param tool - fixed reviewed bash command
 * @returns server and request checkpoint evidence
 */
export function modelServer(
    scenario: string,
    tool = 'test -z "$OPENAI_API_KEY$ANTHROPIC_AUTH_TOKEN$E2E_SECRET" && printf tool-ok',
): {
    server: ReturnType<typeof Bun.serve>
    requests: ModelRequest[]
} {
    const requests: ModelRequest[] = []
    const server = Bun.serve({
        hostname: '127.0.0.1',
        port: 0,
        async fetch(request) {
            if (
                new URL(request.url).pathname !== '/v1/chat/completions' ||
                request.headers.get('authorization') !== `Bearer ${DUMMY_KEY}`
            ) {
                return new Response('Invalid fixture request', { status: 400 })
            }

            const body = (await request.json()) as ModelRequest

            requests.push(body)

            if (body.stream === false) {
                return Response.json({
                    choices: [{ message: { content: 'Research answer' }, finish_reason: 'stop' }],
                    citations: ['https://example.test/source'],
                    search_results: [
                        { title: 'Example', url: 'https://example.test', snippet: 'Snippet' },
                    ],
                })
            }

            if (
                scenario === 'terminal-error' ||
                (scenario === 'retry-success' && requests.length === 1)
            ) {
                return Response.json(
                    {
                        error: {
                            message:
                                scenario === 'terminal-error' ? 'Invalid model' : '503 overloaded',
                            type: 'server_error',
                        },
                    },
                    { status: scenario === 'terminal-error' ? 400 : 503 },
                )
            }

            if (scenario === 'overflow') {
                return Response.json(
                    {
                        error: {
                            message: 'maximum context length exceeded',
                            type: 'invalid_request_error',
                        },
                    },
                    { status: 400 },
                )
            }

            if (scenario === 'timeout' || scenario === 'cancelled') {
                return new Promise<Response>(resolve => {
                    request.signal.addEventListener(
                        'abort',
                        () => resolve(new Response('', { status: 499 })),
                        { once: true },
                    )
                })
            }

            const toolDone = body.messages.some(message => message.role === 'tool')
            const tools = ['success', 'distribution', 'parallel', 'cancel-group'].includes(scenario)
            const delta =
                tools && !toolDone
                    ? {
                          tool_calls: [
                              {
                                  index: 0,
                                  id: 'call_e2e',
                                  type: 'function',
                                  function: {
                                      name: 'bash',
                                      arguments: JSON.stringify({ command: tool }),
                                  },
                              },
                          ],
                      }
                    : {
                          content:
                              scenario === 'parallel'
                                  ? (/LAB_OUTPUT_\d+/.exec(
                                        JSON.stringify(
                                            body.messages.find(message => message.role === 'user')
                                                ?.content,
                                        ) ?? '',
                                    )?.[0] ?? 'missing')
                                  : ANSWER,
                      }
            const chunk = {
                id: 'chat-e2e',
                object: 'chat.completion.chunk',
                created: 1,
                model: body.model,
                choices: [
                    { index: 0, delta: { role: 'assistant', ...delta }, finish_reason: null },
                ],
            }
            const final = {
                ...chunk,
                choices: [
                    {
                        index: 0,
                        delta: {},
                        finish_reason: 'tool_calls' in delta ? 'tool_calls' : 'stop',
                    },
                ],
                usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
            }

            return new Response(
                `data: ${JSON.stringify(chunk)}\n\ndata: ${JSON.stringify(final)}\n\ndata: [DONE]\n\n`,
                { headers: { 'Content-Type': 'text/event-stream' } },
            )
        },
    })

    return { server, requests }
}
