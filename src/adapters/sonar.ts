import type { Adapter, ChatRequest, Completion } from './types'

/**
 * Render unusual response values without implicit object stringification.
 * @param value - JSON response value
 * @returns printable scalar or serialized JSON
 */
function display(value: unknown): string {
    if (typeof value === 'string') {
        return value
    }

    return JSON.stringify(value) ?? ''
}

/**
 * Format Sonar's citations or search results as a numbered Markdown section.
 * @param completion - gateway response
 * @param field - section response field
 * @returns the section, or an empty string when Sonar sent none
 */
function section(completion: Completion, field: 'citations' | 'search_results'): string {
    const value = completion[field]

    if (!value || (Array.isArray(value) && value.length === 0)) {
        return ''
    }

    const title = field === 'citations' ? 'Citations' : 'Search results'
    const lines = ['', `## ${title}`, '']

    if (!Array.isArray(value)) {
        lines.push(display(value))
    } else {
        for (const [index, item] of value.entries()) {
            if (!item || typeof item !== 'object') {
                lines.push(`${index + 1}. ${String(item)}`)
                continue
            }

            const entry = item as Record<string, unknown>
            const name = entry.title || entry.name || ''
            const url = entry.url || (field === 'citations' ? entry.href : entry.link) || ''

            lines.push(
                `${index + 1}. ${name ? `${display(name)}${url ? ' — ' : ''}` : ''}${display(url)}`.trimEnd(),
            )

            const snippet = entry.snippet || entry.content || entry.summary

            if (field === 'search_results' && snippet) {
                lines.push(`   ${display(snippet)}`)
            }
        }
    }

    return `${lines.join('\n')}\n`
}

/**
 * Join the answer's text, which may arrive as a string or as content blocks.
 * @param content - the choice's message content
 * @returns the plain answer text
 */
function answerText(content: unknown): string {
    const parts: unknown[] = Array.isArray(content) ? content : [content]

    return parts
        .map(part => {
            if (typeof part === 'string') {
                return part
            }

            const block = part as { type?: string; text?: string } | null

            return block?.type === 'text' && typeof block.text === 'string' ? block.text : ''
        })
        .join('')
}

/**
 * Replay one chat completion as the two-chunk stream Pi reads, with its sources in the text.
 * @param completion - the gateway's non-streamed answer
 * @returns server-sent events ending in [DONE]
 */
export function replay(completion: Completion): string {
    const choice = completion.choices?.[0]
    const text = answerText(choice?.message?.content).trimEnd()
    const sources = `${section(completion, 'citations')}${section(completion, 'search_results')}`
    const base = {
        id: completion.id ?? 'sonar',
        object: 'chat.completion.chunk',
        created: completion.created ?? 0,
        model: completion.model ?? 'sonar-pro',
    }
    const chunks = [
        {
            ...base,
            choices: [
                {
                    index: 0,
                    delta: { role: 'assistant', content: text && `${text}\n${sources}` },
                    finish_reason: null,
                },
            ],
        },
        {
            ...base,
            choices: [{ index: 0, delta: {}, finish_reason: choice?.finish_reason ?? 'stop' }],
            usage: completion.usage,
        },
    ]

    return `${chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('')}data: [DONE]\n\n`
}

/**
 * Sonar cannot call tools, and through TrueFoundry it answers a streamed request with one
 * JSON completion, which Pi reads as an empty stream. Drop the tools and replay the JSON.
 */
export const sonar: Adapter = {
    models: ['sonar-pro'],
    request({ tools: _tools, tool_choice: _choice, ...body }: ChatRequest): ChatRequest {
        return body
    },
    async response(response: Response): Promise<Response> {
        if (!response.headers.get('content-type')?.includes('application/json')) {
            return response
        }

        return new Response(replay((await response.json()) as Completion), {
            headers: { 'content-type': 'text/event-stream' },
        })
    },
}
