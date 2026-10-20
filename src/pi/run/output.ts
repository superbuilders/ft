import { CORRECTION_HEADER } from '../events/constants'
import {
    JSON_OPENING_SPAN,
    OUTPUT_INSTRUCTIONS,
    OUTPUT_PROBLEMS_SHOWN,
    OUTPUT_STARTS_MAX,
} from './constants'

import type { TLocalizedValidationError } from 'typebox/error'
import type { Validator } from 'typebox/schema'

import type { OutputCheck } from './types'

/** How a JSON object or array of objects opens: a bracket, maybe space, then a key or an item. */
const JSON_OPENING = /^(?:\{\s*"|\[\s*[[{"])/

/** Where an object or array may start. */
const OPENING = /[[{]/g

/**
 * Describe validation errors one per line, as a JSON pointer and what is wrong there. Two kinds
 * only repeat another error, so they are left out: a false subschema's (its additionalProperties
 * parent says the same), and an additionalProperties error whose every named property has its
 * own, deeper error, as when a value under a properties map fails its subschema.
 * @param errors - the validator's errors
 * @returns one line per distinct problem
 */
export function describe(errors: TLocalizedValidationError[]): string[] {
    const real = errors.filter(error => error.keyword !== 'boolean')
    const lines = real
        .filter(error => {
            const names = (error.params as { additionalProperties?: unknown }).additionalProperties

            if (error.keyword !== 'additionalProperties' || !Array.isArray(names)) {
                return true
            }

            return !names.every(name =>
                real.some(other =>
                    other.instancePath.startsWith(`${error.instancePath}/${String(name)}`),
                ),
            )
        })
        .map(error => `${error.instancePath || '(top level)'}: ${error.message}`)

    if (lines.length === 0 && errors.length > 0) {
        return [
            ...new Set(
                errors.map(
                    error => `${error.instancePath || '(top level)'}: is not allowed by the schema`,
                ),
            ),
        ]
    }

    return [...new Set(lines)]
}

/**
 * The instructions ft adds after the brief of a run with an output schema.
 * @param output - the run's output schema
 * @returns markdown to append to the brief
 */
export function outputInstructions(output: Validator): string {
    return `\n\n${OUTPUT_INSTRUCTIONS}\n\n\`\`\`json\n${JSON.stringify(output.Schema(), null, 4)}\n\`\`\`\n`
}

/**
 * Join problems into one short line, counting the ones left out, for an error message.
 * @param problems - one per entry
 * @returns the shown problems, separated by semicolons
 */
export function problemList(problems: string[]): string {
    const shown = problems.slice(0, OUTPUT_PROBLEMS_SHOWN).join('; ')
    const more = problems.length - OUTPUT_PROBLEMS_SHOWN

    return more > 0 ? `${shown}; and ${more} more` : shown
}

/**
 * Take off a code fence around the whole message, if there is one: only its first and last lines
 * go, so backticks inside the JSON, such as a code block in a string, are never touched.
 * @param text - the trimmed message
 * @returns the fenced text, or the message as it was
 */
function unfence(text: string): string {
    const lines = text.split('\n')
    const open = /^(`{3,}|~{3,})[^`]*$/.exec(lines[0]?.trim() ?? '')

    if (!open || lines.length < 2) {
        return text
    }

    const close = lines.at(-1)?.trim() ?? ''

    if (!close.startsWith(open[1][0]) || close.length < open[1].length || /[^`~]/.test(close)) {
        return text
    }

    return lines.slice(1, -1).join('\n')
}

/**
 * Parse text as JSON without throwing.
 * @param text - candidate JSON
 * @returns the value, or the parser's message
 */
function parse(text: string): { value: unknown } | { error: string } {
    try {
        return { value: JSON.parse(text) as unknown }
    } catch (error) {
        return { error: error instanceof Error ? error.message : 'unreadable JSON' }
    }
}

/**
 * Where the JSON object or array that starts at an opening bracket ends, reading strings and
 * escapes as JSON does, so a bracket inside a string is not structure.
 * @param text - the answer
 * @param start - index of an opening bracket
 * @returns the index just past its closing bracket, or -1 when it never closes
 */
function containerEnd(text: string, start: number): number {
    let depth = 0
    let inString = false

    for (let index = start; index < text.length; index++) {
        const char = text[index]

        if (inString) {
            if (char === '\\') {
                index++
            } else if (char === '"') {
                inString = false
            }
        } else if (char === '"') {
            inString = true
        } else if (char === '{' || char === '[') {
            depth++
        } else if ((char === '}' || char === ']') && --depth === 0) {
            return index + 1
        }
    }

    return -1
}

/**
 * The next opening bracket at or after an index.
 * @param text - the answer
 * @param from - where to start looking
 * @returns its index, or -1
 */
function nextOpening(text: string, from: number): number {
    OPENING.lastIndex = from

    return OPENING.exec(text)?.index ?? -1
}

/**
 * Every top-level JSON object in prose, in order. From each opening bracket the search goes on
 * after the span that closes it, so nothing inside another object or array, even a broken one, is
 * a candidate of its own: an array of objects is never read as its first object. A bracket that
 * never closes is retried from the next one, unless it opens like JSON, whose inside is the rest
 * of the text. Each of those costs a scan to the end, so there is a limit on them.
 * @param text - the answer
 * @returns the objects found, or undefined when the limit stopped the search before the end
 */
function objectsIn(text: string): Record<string, unknown>[] | undefined {
    const found: Record<string, unknown>[] = []
    let unclosed = 0

    for (let index = nextOpening(text, 0); index >= 0; ) {
        const end = containerEnd(text, index)

        if (end > 0) {
            const parsed = text[index] === '{' ? parse(text.slice(index, end)) : {}

            if ('value' in parsed && parsed.value) {
                found.push(parsed.value as Record<string, unknown>)
            }

            index = nextOpening(text, end)
        } else if (JSON_OPENING.test(text.slice(index, index + JSON_OPENING_SPAN))) {
            return found
        } else if (++unclosed === OUTPUT_STARTS_MAX) {
            return undefined
        } else {
            index = nextOpening(text, index + 1)
        }
    }

    return found
}

/**
 * Why the object or array a message opens with cannot be read, when it opens with one.
 * @param text - the message, trimmed and unfenced
 * @returns the parser's message, or undefined when the message does not open with broken JSON
 */
function brokenLead(text: string): string | undefined {
    if (!text.startsWith('{') && !text.startsWith('[')) {
        return undefined
    }

    const end = containerEnd(text, 0)
    const lead = parse(end > 0 ? text.slice(0, end) : text)

    return 'error' in lead ? lead.error : undefined
}

/**
 * Read a final answer that must be one JSON object matching the schema. The whole message, or
 * the whole message in one fence, is read as JSON first. Otherwise every top-level object in the
 * prose is a candidate, and the answer is the one that matches; none, or several different ones,
 * is a problem for the model to fix, since choosing between them could pick a draft. Nothing is
 * repaired: broken JSON goes back to the model rather than being guessed at, and a message that
 * opens with a broken object is not searched for a smaller one inside it.
 * @param text - the model's final message
 * @param output - the run's output schema
 * @returns the object, or what is wrong
 */
export function checkOutput(text: string, output: Validator): OutputCheck {
    const whole = unfence(text.trim())
    const direct = parse(whole)

    if ('value' in direct) {
        if (output.Check(direct.value)) {
            return { ok: true, value: direct.value as Record<string, unknown>, recovered: false }
        }

        return { ok: false, problems: describe(output.Errors(direct.value)[1]) }
    }

    const broken = brokenLead(whole)

    if (broken) {
        return { ok: false, problems: [`the JSON could not be read: ${broken}`] }
    }

    const candidates = objectsIn(text)

    if (!candidates) {
        return {
            ok: false,
            problems: [
                'the message has too many braces to search for the JSON object; send only the object',
            ],
        }
    }

    const matching = [
        ...new Map(
            candidates
                .filter(candidate => output.Check(candidate))
                .map(candidate => [JSON.stringify(candidate), candidate]),
        ).values(),
    ]

    if (matching.length === 1) {
        return { ok: true, value: matching[0], recovered: true }
    }

    if (matching.length > 1) {
        return {
            ok: false,
            problems: [
                `the message holds ${matching.length} different JSON objects that match the schema; send only the one you mean`,
            ],
        }
    }

    const last = candidates.at(-1)

    if (last) {
        return { ok: false, problems: describe(output.Errors(last)[1]) }
    }

    return { ok: false, problems: ['the message holds no JSON object'] }
}

/**
 * The message ft sends a run whose final answer did not match, asking for the object alone. It
 * names only the problems, never the answer back, so it stays short.
 * @param problems - what is wrong
 * @returns the correction, as the model will read it
 */
export function correctionMessage(problems: string[]): string {
    const shown = problems.slice(0, OUTPUT_PROBLEMS_SHOWN).map(problem => `- ${problem}`)
    const more = problems.length - OUTPUT_PROBLEMS_SHOWN

    if (more > 0) {
        shown.push(`- and ${more} more`)
    }

    return `${CORRECTION_HEADER}\n\nYour last message did not give the required output:\n\n${shown.join('\n')}\n\nReply with only the corrected JSON object, matching the schema in the brief, and no other text.`
}
