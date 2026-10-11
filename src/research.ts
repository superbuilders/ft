import { RESEARCH_SYSTEM } from './constants'
import { getKey } from './key'

import type { ResolvedConfig } from './types'

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
 * Normalize citation and search-result sections from the existing Sonar helper.
 * @param data - gateway response
 * @param field - section response field
 * @returns formatted Markdown section
 */
function section(data: Record<string, unknown>, field: 'citations' | 'search_results'): string {
    const value = data[field]

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
 * Execute one non-streaming research request with an in-memory credential.
 * @param config - project gateway and key source
 * @param brief - research instructions
 * @param context - bounded project instructions
 * @param signal - run cancellation
 * @returns formatted answer and raw JSON event record
 */
export async function research(
    config: ResolvedConfig,
    brief: string,
    context: string,
    signal: AbortSignal,
): Promise<{ text: string; event: string; stopReason: string }> {
    const key = await getKey(config, signal)
    const response = await fetch(`${config.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        signal,
        headers: {
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
        },
        body: JSON.stringify({
            model: 'sonar-pro',
            stream: false,
            messages: [
                { role: 'system', content: `${RESEARCH_SYSTEM}${context ? `\n\n${context}` : ''}` },
                { role: 'user', content: brief },
            ],
        }),
    })

    if (!response.ok) {
        throw new Error(`Research model HTTP ${response.status}`)
    }

    const data = (await response.json()) as Record<string, unknown>
    const choices = data.choices as
        | { message?: { content?: unknown }; finish_reason?: string }[]
        | undefined
    const content = choices?.[0]?.message?.content
    const parts: unknown[] = Array.isArray(content) ? content : [content]
    const text = parts
        .map(part => {
            if (typeof part === 'string') {
                return part
            }

            const block = part as { type?: string; text?: string } | null

            return block?.type === 'text' && typeof block.text === 'string' ? block.text : ''
        })
        .join('')

    if (!text.trim()) {
        throw new Error('Research model returned empty assistant content')
    }

    return {
        text: `${text.trimEnd()}\n${section(data, 'citations')}${section(data, 'search_results')}`,
        event: `${JSON.stringify({ type: 'research_response', response: data })}\n`,
        stopReason: choices?.[0]?.finish_reason ?? 'stop',
    }
}
