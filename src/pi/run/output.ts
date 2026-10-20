import { Compile, Errors } from 'typebox/schema'

import {
    CORRECTION_HEADER,
    OUTPUT_INSTRUCTIONS,
    OUTPUT_META_SCHEMA,
    OUTPUT_PROBLEMS_SHOWN,
    OUTPUT_STARTS_MAX,
    CHILD_KEYWORDS,
    SAME_VALUE_KEYWORDS,
    SAME_VALUE_LISTS,
    SCHEMA_MAPS,
    SAME_VALUE_MAPS,
    REFERENCE_NOTES,
    JSON_OPENING_SPAN,
} from './constants'

import type { TLocalizedValidationError } from 'typebox/error'

import type { OutputCheck, OutputSchema, SchemaChild } from './types'

const META_SCHEMA = JSON.parse(OUTPUT_META_SCHEMA) as Record<string, unknown>

/** How a JSON object opens: a brace, maybe space, then a key's quote. */
const JSON_OPENING = /^\{\s*"/

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
 * The subschemas directly under a schema, found by keyword: data such as `const` or `examples` is
 * not a schema, so a `$ref` key inside it is not a reference.
 * @param node - a schema
 * @returns each child schema, and whether it applies to the same value as its parent
 */
function children(node: unknown): SchemaChild[] {
    if (!node || typeof node !== 'object' || Array.isArray(node)) {
        return []
    }

    return Object.entries(node).flatMap(([key, value]: [string, unknown]): SchemaChild[] => {
        if (SAME_VALUE_LISTS.includes(key) && Array.isArray(value)) {
            return value.map(schema => ({ schema, same: true }))
        }

        if (SAME_VALUE_KEYWORDS.includes(key)) {
            return [{ schema: value, same: true }]
        }

        if (SCHEMA_MAPS.includes(key) && value && typeof value === 'object') {
            return Object.values(value).map(schema => ({ schema, same: false }))
        }

        if (SAME_VALUE_MAPS.includes(key) && value && typeof value === 'object') {
            return Object.values(value).map(schema => ({ schema, same: true }))
        }

        if (key === 'items' && Array.isArray(value)) {
            return value.map(schema => ({ schema, same: false }))
        }

        return CHILD_KEYWORDS.includes(key) ? [{ schema: value, same: false }] : []
    })
}

/**
 * The schema a local reference (`#` or `#/a/b`) names.
 * @param schema - the whole schema
 * @param reference - a `$ref` that starts with `#`
 * @returns the schema it names, or undefined when a step of its JSON pointer is missing
 */
function resolve(schema: Record<string, unknown>, reference: string): unknown {
    const steps = reference
        .slice(1)
        .split('/')
        .slice(1)
        .map(step => decodeURIComponent(step).replaceAll('~1', '/').replaceAll('~0', '~'))
    let node: unknown = schema

    for (const step of steps) {
        if (!node || typeof node !== 'object' || !Object.hasOwn(node, step)) {
            return undefined
        }

        node = (node as Record<string, unknown>)[step]
    }

    return node
}

/**
 * The schemas that apply to the same value as this one: its `$ref` target and its same-value
 * children, such as allOf's entries. Checking a value follows these without moving into it.
 * @param schema - the whole schema
 * @param node - one schema inside it
 * @returns those schemas
 */
function sameValue(schema: Record<string, unknown>, node: unknown): unknown[] {
    const reference = (node as { $ref?: unknown }).$ref
    const next = children(node)
        .filter(child => child.same)
        .map(child => child.schema)

    return typeof reference === 'string' ? [...next, resolve(schema, reference)] : next
}

/**
 * Every schema in a schema, found through schema keywords only, so nothing inside data such as
 * `examples` is one.
 * @param schema - the whole schema
 * @returns the schema objects, the whole schema first
 */
function positions(schema: Record<string, unknown>): Set<unknown> {
    const found = new Set<unknown>()
    const pending: unknown[] = [schema]

    for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
        if (node && typeof node === 'object' && !found.has(node)) {
            found.add(node)
            pending.push(...children(node).map(child => child.schema))
        }
    }

    return found
}

/**
 * Check one schema's `$ref` and `$id`. A reference must be a pointer inside the schema (`#` or
 * `#/...`) to another schema, and stand alone: draft-07 ignores keywords beside it, but the
 * validator would apply them, so the two readings never get the chance to differ. An `$id` below
 * the top would change what those pointers mean.
 * @param schema - the whole schema
 * @param schemas - every schema in it
 * @param node - the schema to check
 * @returns nothing; throws on a problem
 */
function checkReference(
    schema: Record<string, unknown>,
    schemas: Set<unknown>,
    node: object,
): void {
    if (node !== schema && '$id' in node) {
        throw new Error(
            'the output schema has an $id below its top level, which ft does not support',
        )
    }

    const reference = (node as { $ref?: unknown }).$ref

    if (typeof reference !== 'string') {
        return
    }

    if (reference !== '#' && !reference.startsWith('#/')) {
        throw new Error(
            `the output schema has a reference ft cannot follow (only "#" and "#/..." pointers inside the schema): ${reference}`,
        )
    }

    const target = resolve(schema, reference)

    if (target === undefined) {
        throw new Error(`the output schema refers to a place it does not have: ${reference}`)
    }

    if (typeof target !== 'boolean' && !schemas.has(target)) {
        throw new Error(`the output schema refers to something that is not a schema: ${reference}`)
    }

    const beside = Object.keys(node).filter(key => key !== '$ref' && !REFERENCE_NOTES.includes(key))

    if (beside.length > 0) {
        throw new Error(
            `the output schema puts ${beside.join(', ')} beside "$ref": ${reference}, which JSON Schema draft-07 ignores; put the reference and the other keywords in an allOf`,
        )
    }
}

/**
 * Check every `$ref` in a schema (see checkReference), and that no chain of them leads back to
 * where it started without moving into the value, as `"$ref": "#"` at the top does: checking any
 * answer against that never ends. A chain that passes through a property or an array item is
 * fine, since that is how a tree is described.
 * @param schema - the whole schema
 * @returns nothing; throws on the first bad reference
 */
function checkReferences(schema: Record<string, unknown>): void {
    const schemas = positions(schema)
    const state = new Map<unknown, 'open' | 'done'>()

    /**
     * Follow same-value links from one schema, failing on a loop.
     * @param node - the schema
     * @returns nothing
     */
    function follow(node: unknown): void {
        if (!node || typeof node !== 'object' || state.get(node) === 'done') {
            return
        }

        if (state.get(node) === 'open') {
            throw new Error(
                'the output schema refers to itself without end, so no answer could be checked',
            )
        }

        state.set(node, 'open')
        sameValue(schema, node).forEach(follow)
        state.set(node, 'done')
    }

    schemas.forEach(node => checkReference(schema, schemas, node as object))
    schemas.forEach(follow)
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

    checkReferences(record)

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
 * Every top-level JSON object in prose, in order: from each opening brace, the search goes on after
 * the span that closes it, kept when it parses, so an object inside another, even a broken one, is
 * never a candidate of its own. A brace that never closes is retried from the next one, unless it
 * opens like a JSON object, whose inside is the rest of the text. Braces in the prose cost one
 * failed start each, up to a limit.
 * @param text - the answer
 * @returns the objects found, or undefined when the limit stopped the search before the end
 */
function objectsIn(text: string): Record<string, unknown>[] | undefined {
    const found: Record<string, unknown>[] = []
    let starts = 0

    for (let index = text.indexOf('{'); index >= 0; ) {
        if (starts === OUTPUT_STARTS_MAX) {
            return undefined
        }

        const end = objectEnd(text, index)
        const parsed = end > 0 ? parse(text.slice(index, end)) : null

        starts++

        if (parsed && 'value' in parsed) {
            found.push(parsed.value as Record<string, unknown>)
        }

        /* An object that opens like JSON and never closes holds the rest of the text. */
        if (end < 0 && JSON_OPENING.test(text.slice(index, index + JSON_OPENING_SPAN))) {
            return found
        }

        index = text.indexOf('{', end > 0 ? end : index + 1)
    }

    return found
}

/**
 * Why the object a message opens with cannot be read, when it opens with one.
 * @param text - the message, trimmed and unfenced
 * @returns the parser's message, or undefined when the message does not open with a broken object
 */
function brokenLead(text: string): string | undefined {
    if (!text.startsWith('{')) {
        return undefined
    }

    const end = objectEnd(text, 0)

    if (end < 0) {
        const whole = parse(text)

        return 'error' in whole ? whole.error : undefined
    }

    const lead = parse(text.slice(0, end))

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
export function checkOutput(text: string, output: OutputSchema): OutputCheck {
    const whole = unfence(text.trim())
    const direct = parse(whole)

    if ('value' in direct) {
        if (output.validator.Check(direct.value)) {
            return { ok: true, value: direct.value as Record<string, unknown>, recovered: false }
        }

        return { ok: false, problems: describe(output.validator.Errors(direct.value)[1]) }
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
