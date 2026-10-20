import { Format } from 'typebox/format'
import { Compile, Errors, Pointer } from 'typebox/schema'

import {
    CHILD_KEYWORDS,
    DEFINITION_MAPS,
    OUTPUT_META_SCHEMA,
    REFERENCE_NOTES,
    SAME_VALUE_KEYWORDS,
    SAME_VALUE_LISTS,
    SAME_VALUE_MAPS,
    SCHEMA_MAPS,
} from './constants'
import { describe, problemList } from './output'

import type { Validator } from 'typebox/schema'

import type { SchemaChild } from './types'

const META_SCHEMA = JSON.parse(OUTPUT_META_SCHEMA) as Record<string, unknown>

/** The `$schema` values that name draft-07, the only dialect ft checks answers with. */
const DRAFT_07 = /^https?:\/\/json-schema\.org\/draft-07\/schema#?$/

/**
 * A JSON pointer segment, escaped as RFC 6901 asks.
 * @param key - a property name or array index
 * @returns the segment
 */
function segment(key: string): string {
    return key.replaceAll('~', '~0').replaceAll('/', '~1')
}

/**
 * The subschemas directly under a schema, found by keyword: data such as `const` or `examples` is
 * not a schema, so a `$ref` key inside it is not a reference.
 * @param node - a schema
 * @returns each child schema, with its pointer below the parent and how it relates to the parent
 */
function children(node: unknown): SchemaChild[] {
    if (!node || typeof node !== 'object' || Array.isArray(node)) {
        return []
    }

    return Object.entries(node).flatMap(([key, value]: [string, unknown]): SchemaChild[] => {
        const at = `/${segment(key)}`
        const same =
            SAME_VALUE_KEYWORDS.includes(key) ||
            SAME_VALUE_LISTS.includes(key) ||
            SAME_VALUE_MAPS.includes(key)
        const definition = DEFINITION_MAPS.includes(key)
        const list = (SAME_VALUE_LISTS.includes(key) || key === 'items') && Array.isArray(value)
        const map =
            (SCHEMA_MAPS.includes(key) || SAME_VALUE_MAPS.includes(key) || definition) &&
            Boolean(value) &&
            typeof value === 'object' &&
            !Array.isArray(value)

        if (list || map) {
            return Object.entries(value as object).map(([name, schema]: [string, unknown]) => ({
                schema,
                same,
                definition,
                pointer: `${at}/${segment(name)}`,
            }))
        }

        return SAME_VALUE_KEYWORDS.includes(key) || CHILD_KEYWORDS.includes(key)
            ? [{ schema: value, same, definition: false, pointer: at }]
            : []
    })
}

/**
 * The JSON pointer a local reference (`#` or `#/a/b`) holds, decoded from its URI form.
 * @param reference - a `$ref` that starts with `#`
 * @returns the pointer, empty for the whole schema
 */
function pointerOf(reference: string): string {
    return decodeURIComponent(reference.slice(1))
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

    return typeof reference === 'string'
        ? [...next, Pointer.Get(schema, pointerOf(reference))]
        : next
}

/**
 * Every schema in a schema, by its JSON pointer, found through schema keywords only, so nothing
 * inside data such as `examples` is one.
 * @param schema - the whole schema
 * @returns each schema's pointer and the schema, the whole schema first
 */
function positions(schema: Record<string, unknown>): Map<string, unknown> {
    const found = new Map<string, unknown>()
    const pending: { pointer: string; node: unknown }[] = [{ pointer: '', node: schema }]

    for (let next = pending.pop(); next; next = pending.pop()) {
        found.set(next.pointer, next.node)
        pending.push(
            ...children(next.node).map(child => ({
                pointer: next.pointer + child.pointer,
                node: child.schema,
            })),
        )
    }

    return found
}

/**
 * The schemas an answer can be checked against: the whole schema, and every schema reached from
 * it through keywords and references. A definition nothing refers to is not one.
 * @param schema - the whole schema
 * @returns those schemas
 */
function reachable(schema: Record<string, unknown>): Set<unknown> {
    const found = new Set<unknown>()
    const pending: unknown[] = [schema]

    for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
        if (node && typeof node === 'object' && !found.has(node)) {
            const reference = (node as { $ref?: unknown }).$ref

            found.add(node)
            pending.push(
                ...children(node)
                    .filter(child => !child.definition)
                    .map(child => child.schema),
            )

            if (typeof reference === 'string') {
                pending.push(Pointer.Get(schema, pointerOf(reference)))
            }
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
 * @param schemas - every schema in it, by pointer
 * @param node - the schema to check
 * @returns nothing; throws on a problem
 */
function checkReference(
    schema: Record<string, unknown>,
    schemas: Map<string, unknown>,
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

    if (Pointer.Get(schema, pointerOf(reference)) === undefined) {
        throw new Error(`the output schema refers to a place it does not have: ${reference}`)
    }

    if (!schemas.has(pointerOf(reference))) {
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
 * Check that no chain of references and same-value keywords leads back to where it started
 * without moving into the value, as `"$ref": "#"` at the top does: checking any answer against
 * that never ends. A chain through a property or an array item is fine, since that is how a tree
 * is described, and so is a loop in a definition nothing uses.
 * @param schema - the whole schema
 * @returns nothing; throws on a loop
 */
function checkLoops(schema: Record<string, unknown>): void {
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

    reachable(schema).forEach(follow)
}

/**
 * Check that every `format` is one the validator knows: it lets an unknown one, such as a
 * misspelt `"emial"`, accept any string.
 * @param schemas - every schema in the output schema
 * @returns nothing; throws on the first unknown format
 */
function checkFormats(schemas: Iterable<unknown>): void {
    for (const node of schemas) {
        const format = (node as { format?: unknown } | null)?.format

        if (typeof format === 'string' && !Format.Has(format)) {
            const known = Format.Entries()
                .map(([name]) => name)
                .toSorted()

            throw new Error(
                `the output schema uses a format ft does not know: ${format} (it knows ${known.join(', ')})`,
            )
        }
    }
}

/**
 * Check a caller's output schema and compile it. A schema the checker would misread fails here,
 * before any run starts: a malformed or misspelt keyword or format, a dialect other than draft-07,
 * a top level that is not an object, or a reference ft cannot follow, since each would make every
 * answer pass or every answer fail.
 * @param schema - the parsed --output-schema file
 * @returns the schema's validator
 */
export function compileOutputSchema(schema: unknown): Validator {
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
        throw new Error('the output schema must be a JSON object')
    }

    const problems = describe(Errors(META_SCHEMA, schema)[1])
    const record = schema as Record<string, unknown>

    if (problems.length > 0) {
        throw new Error(`the output schema is not valid JSON Schema: ${problemList(problems)}`)
    }

    /* The meta-schema has already checked that $schema, when present, is a string. */
    const declared = record.$schema as string | undefined

    if (declared !== undefined && !DRAFT_07.test(declared)) {
        throw new Error(
            `the output schema declares ${declared}, but ft checks answers with JSON Schema draft-07; use http://json-schema.org/draft-07/schema#, or leave $schema out`,
        )
    }

    if (record.type !== 'object') {
        throw new Error('the output schema\'s top level must be "type": "object"')
    }

    const schemas = positions(record)

    schemas.forEach(node => {
        if (node && typeof node === 'object') {
            checkReference(record, schemas, node)
        }
    })
    checkLoops(record)
    checkFormats(schemas.values())

    try {
        return Compile(record as never)
    } catch (error) {
        throw new Error(
            `the output schema could not be compiled: ${error instanceof Error ? error.message : 'unknown error'}`,
            { cause: error },
        )
    }
}
