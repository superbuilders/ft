import { Compile, Errors } from 'typebox/schema'

import {
    CORRECTION_HEADER,
    OUTPUT_INSTRUCTIONS,
    OUTPUT_META_SCHEMA,
    OUTPUT_PROBLEMS_SHOWN,
    OUTPUT_STARTS_MAX,
} from './constants'

import type { TLocalizedValidationError } from 'typebox/error'

import type { OutputCheck, OutputSchema } from './types'

const META_SCHEMA = JSON.parse(OUTPUT_META_SCHEMA) as Record<string, unknown>

/**
 * Describe validation errors one per line, as a JSON pointer and what is wrong there. Two kinds
 * only repeat another error, so they are left out: a false subschema's (its additionalProperties
 * parent says the same), and an additionalProperties error whose every named property has its
 * own, deeper error, as when a value under a properties map fails its subschema.
 * @param errors - the validator's errors
 * @returns one line per distinct problem
 */
function describe(errors: TLocalizedValidationError[]): string[] {
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

    return [...new Set(lines)]
}

/**
 * Every `$ref` in a schema, wherever it sits.
 * @param node - a schema or any value inside one
 * @returns the reference strings
 */
function references(node: unknown): string[] {
    if (Array.isArray(node)) {
        return node.flatMap(references)
    }

    if (!node || typeof node !== 'object') {
        return []
    }

    return Object.entries(node).flatMap(([key, value]) =>
        key === '$ref' && typeof value === 'string' ? [value] : references(value),
    )
}

/**
 * Whether a local reference (`#` or `#/a/b`) names a place inside the schema.
 * @param schema - the whole schema
 * @param reference - a `$ref` that starts with `#`
 * @returns true when every step of its JSON pointer exists
 */
function resolves(schema: Record<string, unknown>, reference: string): boolean {
    const steps = reference
        .slice(1)
        .split('/')
        .slice(1)
        .map(step => decodeURIComponent(step).replaceAll('~1', '/').replaceAll('~0', '~'))
    let node: unknown = schema

    for (const step of steps) {
        if (!node || typeof node !== 'object' || !Object.hasOwn(node, step)) {
            return false
        }

        node = (node as Record<string, unknown>)[step]
    }

    return true
}

/**
 * Check a caller's output schema and compile it. A schema the checker would misread fails here,
 * before any run starts: a malformed or misspelt keyword, a top level that is not an object, or a
 * reference ft cannot follow, since each would make every answer pass or every answer fail.
 * @param schema - the parsed --output-schema file
 * @returns the schema with its validator
 */
export function compileOutputSchema(schema: unknown): OutputSchema {
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
        throw new Error('the output schema must be a JSON object')
    }

    const problems = describe(Errors(META_SCHEMA, schema)[1])
    const record = schema as Record<string, unknown>

    if (problems.length > 0) {
        throw new Error(`the output schema is not valid JSON Schema: ${problemList(problems)}`)
    }

    if (record.type !== 'object') {
        throw new Error('the output schema\'s top level must be "type": "object"')
    }

    for (const reference of references(record)) {
        if (!reference.startsWith('#')) {
            throw new Error(
                `the output schema refers outside itself, which ft cannot follow: ${reference}`,
            )
        }

        if (!resolves(record, reference)) {
            throw new Error(`the output schema refers to a place it does not have: ${reference}`)
        }
    }

    try {
        return { schema: record, validator: Compile(record as never) }
    } catch (error) {
        throw new Error(
            `the output schema could not be compiled: ${error instanceof Error ? error.message : 'unknown error'}`,
            { cause: error },
        )
    }
}

/**
 * The instructions ft adds after the brief of a run with an output schema.
 * @param output - the run's output schema
 * @returns markdown to append to the brief
 */
export function outputInstructions(output: OutputSchema): string {
    return `\n\n${OUTPUT_INSTRUCTIONS}\n\n\`\`\`json\n${JSON.stringify(output.schema, null, 4)}\n\`\`\`\n`
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

    if (close[0] !== open[1][0] || close.length < open[1].length || /[^`~]/.test(close)) {
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
 * Where the JSON object that starts at an opening brace ends, reading strings and escapes as JSON
 * does, so a brace inside a string is not structure.
 * @param text - the answer
 * @param start - index of an opening brace
 * @returns the index just past its closing brace, or -1 when it never closes
 */
function objectEnd(text: string, start: number): number {
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
        } else if (char === '}' || char === ']') {
            depth--

            if (depth === 0) {
                return char === '}' ? index + 1 : -1
            }

            if (depth < 0) {
                return -1
            }
        }
    }

    return -1
}

/**
 * Every top-level JSON object in prose, in order: from each opening brace, the span that closes it
 * is kept when it parses, and the search goes on after it, so an object inside another is never a
 * candidate of its own. Braces in the prose cost one failed start each, up to a limit.
 * @param text - the answer
 * @returns the objects found
 */
function objectsIn(text: string): Record<string, unknown>[] {
    const found: Record<string, unknown>[] = []
    let starts = 0

    for (let index = text.indexOf('{'); index >= 0 && starts < OUTPUT_STARTS_MAX; ) {
        const end = objectEnd(text, index)
        const parsed = end > 0 ? parse(text.slice(index, end)) : null

        starts++

        if (parsed && 'value' in parsed) {
            found.push(parsed.value as Record<string, unknown>)
            index = text.indexOf('{', end)
        } else {
            index = text.indexOf('{', index + 1)
        }
    }

    return found
}

/**
 * Read a final answer that must be one JSON object matching the schema. The whole message, or
 * the whole message in one fence, is read as JSON first. Otherwise every top-level object in the
 * prose is a candidate, and the answer is the one that matches; none, or several different ones,
 * is a problem for the model to fix, since choosing between them could pick a draft. Nothing is
 * repaired: broken JSON goes back to the model rather than being guessed at.
 * @param text - the model's final message
 * @param output - the run's output schema
 * @returns the object, or what is wrong
 */
export function checkOutput(text: string, output: OutputSchema): OutputCheck {
    const whole = unfence(text.trim())
    const direct = parse(whole)

    if ('value' in direct) {
        if (output.validator.Check(direct.value)) {
            return { ok: true, value: direct.value as Record<string, unknown>, recovered: false }
        }

        return { ok: false, problems: describe(output.validator.Errors(direct.value)[1]) }
    }

    const candidates = objectsIn(text)
    const matching = [
        ...new Map(
            candidates
                .filter(candidate => output.validator.Check(candidate))
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
        return { ok: false, problems: describe(output.validator.Errors(last)[1]) }
    }

    if (whole.startsWith('{')) {
        return { ok: false, problems: [`the JSON could not be read: ${direct.error}`] }
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
