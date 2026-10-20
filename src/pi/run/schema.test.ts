import { describe, expect, it } from 'vitest'

import { checkOutput } from './output'
import { compileOutputSchema } from './schema'

const FINDINGS = {
    type: 'object',
    additionalProperties: false,
    required: ['findings'],
    properties: {
        findings: {
            type: 'array',
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['id', 'file', 'summary'],
                properties: {
                    id: { type: 'integer', minimum: 1 },
                    file: { type: 'string', minLength: 1 },
                    line: { type: 'integer' },
                    summary: { type: 'string', minLength: 1 },
                    fix: { type: 'string' },
                },
            },
        },
    },
}

describe('compileOutputSchema', () => {
    it('accepts a findings schema, with $schema, local references and $defs', () => {
        expect(compileOutputSchema(FINDINGS).Schema()).toBe(FINDINGS)
        expect(() =>
            compileOutputSchema({
                $schema: 'http://json-schema.org/draft-07/schema#',
                type: 'object',
                $defs: { name: { type: 'string' } },
                definitions: { age: { type: 'integer' } },
                properties: {
                    name: { $ref: '#/$defs/name' },
                    age: { $ref: '#/definitions/age' },
                    self: { $ref: '#' },
                },
            }),
        ).not.toThrow()
    })

    it.each([
        ['an array', [], 'must be a JSON object'],
        ['a boolean schema', true, 'must be a JSON object'],
        ['null', null, 'must be a JSON object'],
        [
            'a top level that is not an object',
            { type: 'array' },
            'top level must be "type": "object"',
        ],
        ['no top-level type', { properties: {} }, 'top level must be "type": "object"'],
        ['a malformed keyword', { type: 'object', properties: 5 }, '/properties: must be object'],
        ['an unknown type name', { type: 'objekt' }, '/type:'],
        [
            'a misspelt keyword',
            { type: 'object', requird: ['a'] },
            'must not have additional properties',
        ],
        [
            'a misspelt keyword deep inside',
            { type: 'object', properties: { a: { type: 'string', minLenght: 1 } } },
            'must not have additional properties',
        ],
        [
            'a reference outside the schema',
            { type: 'object', properties: { a: { $ref: 'https://x.test/a.json' } } },
            'reference ft cannot follow',
        ],
        [
            'a reference by name rather than pointer',
            { type: 'object', properties: { a: { $ref: '#missing' } } },
            'reference ft cannot follow',
        ],
        [
            'a top level that refers to itself',
            { type: 'object', allOf: [{ $ref: '#' }] },
            'refers to itself without end',
        ],
        [
            'keywords beside a reference',
            {
                type: 'object',
                $defs: { s: { type: 'string' } },
                properties: { a: { $ref: '#/$defs/s', maxLength: 2 } },
            },
            'puts maxLength beside "$ref": #/$defs/s',
        ],
        [
            'an $id below the top',
            { type: 'object', properties: { x: { $id: 'child', type: 'string' } } },
            'has an $id below its top level',
        ],
        [
            'a reference into example data',
            {
                type: 'object',
                examples: [{ type: 'strnig' }],
                properties: { x: { $ref: '#/examples/0' } },
            },
            'not a schema: #/examples/0',
        ],
        [
            'a property that refers to itself',
            { type: 'object', properties: { a: { $ref: '#/properties/a' } } },
            'refers to itself without end',
        ],
        [
            'a dependency that refers back to the top',
            { type: 'object', dependencies: { x: { $ref: '#' } } },
            'refers to itself without end',
        ],
        [
            'a reference to something that is not a schema',
            { type: 'object', required: ['a'], properties: { a: { $ref: '#/required' } } },
            'not a schema: #/required',
        ],
        [
            'a reference to a boolean inside data',
            { type: 'object', examples: [true], properties: { x: { $ref: '#/examples/0' } } },
            'not a schema: #/examples/0',
        ],
        [
            'a misspelt format',
            { type: 'object', properties: { e: { type: 'string', format: 'emial' } } },
            'a format ft does not know: emial (it knows ',
        ],
        [
            'a newer dialect',
            { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object' },
            'declares https://json-schema.org/draft/2020-12/schema, but ft checks answers with JSON Schema draft-07',
        ],
        [
            'definitions that refer to each other through allOf',
            {
                type: 'object',
                $defs: { a: { allOf: [{ $ref: '#/$defs/b' }] }, b: { not: { $ref: '#/$defs/a' } } },
                properties: { x: { $ref: '#/$defs/a' } },
            },
            'refers to itself without end',
        ],
        [
            'a reference to nowhere',
            { type: 'object', properties: { a: { $ref: '#/$defs/nope' } } },
            'does not have: #/$defs/nope',
        ],
        [
            'an invalid pattern',
            { type: 'object', properties: { a: { type: 'string', pattern: '(' } } },
            'not valid JSON Schema: /properties/a/pattern: must match format "regex"',
        ],
    ])('refuses %s', (_name, schema, message) => {
        expect(() => compileOutputSchema(schema)).toThrow(message)
    })

    it('accepts a tree, which refers to itself through a property, and checks one', () => {
        const tree = compileOutputSchema({
            type: 'object',
            required: ['name'],
            properties: {
                name: { type: 'string' },
                children: { type: 'array', items: { $ref: '#' } },
            },
        })

        expect(
            checkOutput('{"name":"a","children":[{"name":"b","children":[{"name":"c"}]}]}', tree)
                .ok,
        ).toBe(true)
        expect(checkOutput('{"name":"a","children":[{"children":[]}]}', tree).ok).toBe(false)
    })

    it('accepts notes beside a reference', () => {
        expect(() =>
            compileOutputSchema({
                type: 'object',
                $id: 'https://x.test/answer.json',
                $defs: { s: { type: 'string' } },
                properties: { a: { $ref: '#/$defs/s', description: 'the name', title: 'Name' } },
            }),
        ).not.toThrow()
    })

    it('accepts a reference to a boolean schema, a known format, and draft-07 named over https', () => {
        expect(() =>
            compileOutputSchema({
                $schema: 'https://json-schema.org/draft-07/schema',
                type: 'object',
                $defs: { never: false },
                properties: {
                    gone: { $ref: '#/$defs/never' },
                    when: { type: 'string', format: 'date-time' },
                },
            }),
        ).not.toThrow()
    })

    it('accepts a loop in a definition nothing uses', () => {
        expect(() =>
            compileOutputSchema({
                type: 'object',
                $defs: { loop: { allOf: [{ $ref: '#/$defs/loop' }] } },
                properties: { a: { type: 'string' } },
            }),
        ).not.toThrow()
    })

    it('treats a $ref inside data, such as const or examples, as data', () => {
        expect(() =>
            compileOutputSchema({
                type: 'object',
                properties: {
                    a: { const: { $ref: 'https://x.test' }, examples: [{ $ref: '#/nope' }] },
                },
            }),
        ).not.toThrow()
    })
})
