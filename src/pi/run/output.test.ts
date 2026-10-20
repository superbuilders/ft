import { describe, expect, it } from 'vitest'

import { CORRECTION_HEADER, OUTPUT_PROBLEMS_SHOWN, OUTPUT_STARTS_MAX } from './constants'
import { checkOutput, correctionMessage, problemList } from './output'
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
const output = compileOutputSchema(FINDINGS)
const one = { findings: [{ id: 1, file: 'a.ts', line: 3, summary: 'leaks' }] }
const json = JSON.stringify(one)

describe('checkOutput', () => {
    it('reads a message that is only the object', () => {
        expect(checkOutput(json, output)).toEqual({ ok: true, value: one, recovered: false })
        expect(checkOutput(`\n  ${JSON.stringify(one, null, 2)}  \n`, output).ok).toBe(true)
    })

    it.each([
        ['a json fence', `\`\`\`json\n${json}\n\`\`\``],
        ['an upper-case tag', `\`\`\`JSON\n${json}\n\`\`\``],
        ['an untagged fence', `\`\`\`\n${json}\n\`\`\``],
        ['a tilde fence', `~~~json\n${json}\n~~~`],
        ['a longer fence', `\`\`\`\`json\n${json}\n\`\`\`\``],
    ])('reads a message that is only %s, as not recovered', (_name, text) => {
        expect(checkOutput(text, output)).toEqual({ ok: true, value: one, recovered: false })
    })

    it('keeps backticks and braces inside strings, even a whole code block', () => {
        const tricky = {
            findings: [
                {
                    id: 1,
                    file: 'a.ts',
                    summary: 'returns {} and "quotes"',
                    fix: '```ts\nif (x) { return }\n```\nthen `}` and \\"',
                },
            ],
        }
        const text = JSON.stringify(tricky, null, 2)

        expect(checkOutput(text, output)).toEqual({ ok: true, value: tricky, recovered: false })
        expect(checkOutput(`\`\`\`json\n${text}\n\`\`\``, output)).toEqual({
            ok: true,
            value: tricky,
            recovered: false,
        })
        expect(checkOutput(`Here you go:\n\`\`\`json\n${text}\n\`\`\`\nDone.`, output)).toEqual({
            ok: true,
            value: tricky,
            recovered: true,
        })
    })

    it.each([
        ['prose before a fence', `Here are the findings:\n\`\`\`json\n${json}\n\`\`\``],
        ['prose after a fence', `\`\`\`json\n${json}\n\`\`\`\nLet me know if you need more.`],
        ['an object mid-sentence', `The result is ${json} as requested.`],
        ['braces in prose before it', `I checked {x} and the set {1, 2 then found:\n${json}`],
        ['braces in prose after it', `${json}\nThis follows the {id} pattern, see }`],
        [
            'a schema-shaped draft that does not match first',
            `Draft: {"findings": "todo"}\nFinal:\n${json}`,
        ],
        ['the same object twice', `${json}\nRepeating it: ${json}`],
        [
            'unicode around it',
            `Résumé 😀 ${JSON.stringify({ findings: [{ id: 1, file: 'ü.ts', summary: '日本' }] })} ✓`,
        ],
    ])('recovers the one matching object from %s', (_name, text) => {
        const checked = checkOutput(text, output)

        expect(checked.ok).toBe(true)
        expect(checked.ok && checked.recovered).toBe(true)
    })

    it('never chooses between two different matching objects', () => {
        const other = { findings: [] }
        const checked = checkOutput(`First: ${json}\nActually: ${JSON.stringify(other)}`, output)

        expect(checked).toEqual({
            ok: false,
            problems: [
                'the message holds 2 different JSON objects that match the schema; send only the one you mean',
            ],
        })
    })

    it('does not take an object nested in one that does not match', () => {
        const checked = checkOutput(`Result: {"result": ${json}}`, output)

        expect(checked.ok).toBe(false)
        expect(!checked.ok && checked.problems).toEqual([
            '(top level): must have required properties findings',
            '(top level): must not have additional properties',
        ])
    })

    it('names what is wrong with a whole-message object, by JSON pointer', () => {
        const checked = checkOutput(
            JSON.stringify({ findings: [{ id: 0, file: '', extra: true }] }),
            output,
        )

        expect(checked.ok).toBe(false)
        expect(!checked.ok && checked.problems).toEqual(
            expect.arrayContaining([
                '/findings/0: must have required properties summary',
                '/findings/0: must not have additional properties',
                '/findings/0/id: must be >= 1',
                '/findings/0/file: must not have fewer than 1 characters',
            ]),
        )
    })

    it('reports the schema problems of the last object when none in prose match', () => {
        const checked = checkOutput('Before {"findings": 1} and after {"findings": "x"}', output)

        expect(!checked.ok && checked.problems).toEqual(['/findings: must be array'])
    })

    it.each([
        ['a top-level array', JSON.stringify([one]), '(top level): must be object'],
        ['a bare string', '"done"', '(top level): must be object'],
        ['broken JSON', '{"findings": [{"id": 1,}]}', 'the JSON could not be read'],
        ['broken JSON in a fence', '```json\n{"findings": [\n```', 'the JSON could not be read'],
        [
            'plain prose',
            'No issues found; the function returns [] for empty input.',
            'holds no JSON object',
        ],
        ['an empty message', '', 'holds no JSON object'],
        ['only prose braces', 'Use { a } here }{', 'holds no JSON object'],
        [
            'an empty object in prose',
            'Use {} here',
            '(top level): must have required properties findings',
        ],
    ])('explains %s', (_name, text, problem) => {
        const checked = checkOutput(text, output)

        expect(checked.ok).toBe(false)
        expect(!checked.ok && checked.problems.join(' ')).toContain(problem)
    })

    it('stays quick on prose that is all opening braces', () => {
        const started = performance.now()
        const checked = checkOutput('{'.repeat(1_000_000), output)

        expect(checked.ok).toBe(false)
        expect(performance.now() - started).toBeLessThan(2000)
    })

    it.each([
        ['a trailing comma', `{"result":${json},}`],
        ['a missing closing brace', `{"result":${json}`],
    ])(
        'sends back a message that opens with broken JSON (%s), not an object inside it',
        (_name, text) => {
            const checked = checkOutput(text, output)

            expect(checked.ok).toBe(false)
            expect(!checked.ok && checked.problems[0]).toMatch(/^the JSON could not be read: /)
        },
    )

    it('does not take an object from inside one in prose that never closes', () => {
        const checked = checkOutput(`Here it is: {"result":${json}`, output)

        expect(checked.ok).toBe(false)
    })

    it('still finds the object after a brace in prose that never closes', () => {
        const checked = checkOutput(`Sets look like { a, b. Here it is: ${json}`, output)

        expect(checked.ok && checked.value).toEqual(one)
    })

    it.each([
        ['alone', `[${json}]`],
        ['in prose', `Result: [${json}] Done.`],
        ['in a fence', `\`\`\`json\n[${json}]\n\`\`\``],
        ['in prose, unclosed', `Result: [${json}`],
    ])('does not take an object from inside an array (%s)', (_name, text) => {
        expect(checkOutput(text, output).ok).toBe(false)
    })

    it('still finds the object after an array in prose', () => {
        const checked = checkOutput(`See [1, 2] and ["a]"]. ${json}`, output)

        expect(checked.ok && checked.value).toEqual(one)
    })

    it('does not take an object from inside a broken one in prose', () => {
        const checked = checkOutput(`Here it is: {"result":${json},} Done.`, output)

        expect(checked.ok).toBe(false)
    })

    it('reads past any number of braces in prose that close', () => {
        const checked = checkOutput(`Notes: ${'{x} [y] '.repeat(OUTPUT_STARTS_MAX)}${json}`, output)

        expect(checked.ok && checked.value).toEqual(one)
    })

    it('chooses nothing when too many braces that never close stop the search before the end', () => {
        const prose = `Notes: ${'{ '.repeat(OUTPUT_STARTS_MAX)}`
        const checked = checkOutput(`${prose}${json}`, output)

        expect(!checked.ok && checked.problems).toEqual([
            'the message has too many braces to search for the JSON object; send only the object',
        ])
    })

    it.each([
        [
            'a property the schema forbids',
            { type: 'object', properties: { x: false } },
            '{"x":1}',
            '/x',
        ],
        ['a schema that allows nothing', { type: 'object', allOf: [false] }, '{}', '(top level)'],
    ])('names the place for %s', (_name, schema, text, place) => {
        const checked = checkOutput(text, compileOutputSchema(schema))

        expect(!checked.ok && checked.problems).toEqual([`${place}: is not allowed by the schema`])
    })

    it('reads a large answer', () => {
        const many = {
            findings: Array.from({ length: 5000 }, (_, index) => ({
                id: index + 1,
                file: `src/file-${index}.ts`,
                line: index,
                summary: `finding ${index} with {braces} and "quotes"`,
            })),
        }
        const checked = checkOutput(`Here:\n${JSON.stringify(many)}\nEnd.`, output)

        expect(checked.ok && checked.value).toEqual(many)
    })
})

describe('correctionMessage', () => {
    it('says it comes from ft, lists the problems and asks for the object alone', () => {
        const message = correctionMessage(['/a: must be string'])

        expect(message.startsWith(CORRECTION_HEADER)).toBe(true)
        expect(message).toContain('- /a: must be string')
        expect(message).toContain('Reply with only the corrected JSON object')
    })

    it('counts the problems it leaves out', () => {
        const problems = Array.from(
            { length: OUTPUT_PROBLEMS_SHOWN + 3 },
            (_, index) => `/p${index}: bad`,
        )

        expect(correctionMessage(problems)).toContain('- and 3 more')
        expect(correctionMessage(problems)).not.toContain(`/p${OUTPUT_PROBLEMS_SHOWN}:`)
        expect(problemList(problems)).toMatch(/; and 3 more$/)
    })
})
