import type { RunProfile } from './types'

/** A harness closing its terminal sends SIGHUP; treat it like Ctrl-C so Pi and its tools are stopped. */
export const CANCEL_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const

/** The run's steering socket, in its private scratch folder beside the key socket. */
export const CONTROL_SOCKET = 'control.sock'

/** Longest steering message accepted, in characters; a longer instruction belongs in a new brief. */
export const STEER_MAX_CHARS = 20_000

/** Why a run just starting refuses a steer: Pi has not taken its brief yet. */
export const STILL_STARTING = 'the run is still starting; try again in a few seconds'

/** Pi's command id for one steer, so its response is matched to the steer. */
export const STEER_ID_PREFIX = 'steer-'

/**
 * What each --profile gives the delegate: the Pi tools it may use (a tool-free model gets none
 * whatever the profile), and standing instructions so briefs carry only the task. A brief that
 * says otherwise wins.
 */
export const RUN_PROFILES: Record<string, RunProfile> = {
    read: {
        tools: ['read', 'grep', 'find', 'ls', 'bash'],
        preamble: `# How this run works

You are a delegate. Another agent wrote the brief below and will read your final message, then act on it; nobody can answer questions while you work. That agent may send you messages while you work; they arrive as user messages, and where one conflicts with the brief, the message wins. Your last message is your answer, so if a message arrives after you have answered, answer again in full. Investigate with the tools you have, and say plainly what you could not determine.

Do not change files: this run is for reading and reporting. Your final message is your whole report. Lead with the answer, then the evidence (file paths with line numbers, commands and their output), then anything left open. If the brief asks for something else, the brief wins.`,
    },
    write: {
        tools: ['read', 'grep', 'find', 'ls', 'bash', 'edit', 'write'],
        preamble: `# How this run works

You are a delegate. Another agent wrote the brief below, will review your changes and will commit them; nobody can answer questions while you work. That agent may send you messages while you work; they arrive as user messages, and where one conflicts with the brief, the message wins. Your last message is your answer, so if a message arrives after you have answered, answer again in full. Investigate with the tools you have, and say plainly what you could not determine.

Make the change the brief asks for and nothing else: no unrelated refactors, renames or cleanup. Run the checks this repository's instructions name, and fix what they surface. Do not stage, commit or push. Your final message is your whole report: what changed and why, the files you touched, the check results, and anything left open or needing a decision. If the brief asks for something else, the brief wins.`,
    },
}

/** Corrections ft sends a run whose final answer does not match its --output-schema, before the run fails. */
export const OUTPUT_CORRECTIONS_MAX = 2

/** Problems listed in one correction or failure; the rest are counted, so the message stays short. */
export const OUTPUT_PROBLEMS_SHOWN = 10

/**
 * Places in an answer where a JSON object could start that ft tries before it stops looking, so
 * prose full of braces cannot make recovery slow; giving up only costs a correction.
 */
export const OUTPUT_STARTS_MAX = 200

/** How the run is told that its final message must be JSON, after the brief. */
export const OUTPUT_INSTRUCTIONS = `# Required output

Your final message must be a single JSON object that matches the JSON Schema below, and nothing else: no prose before or after it. This replaces the report format described above. ft checks the object against the schema, and asks you to correct it if it does not match.`

/** Opens every correction, so the model can tell ft's check from a message the caller sent. */
export const CORRECTION_HEADER =
    '[Automatic output check by ft. This message comes from ft, not from the agent that wrote the brief.]'

/**
 * The JSON Schema draft-07 meta-schema, made strict in two ways: `$defs` is accepted as well as
 * `definitions`, and a keyword the draft does not define is an error rather than ignored, so a
 * misspelt keyword in an --output-schema refuses the run instead of letting any answer pass. It
 * is JSON text because it has a `then` key, which would make an object literal look awaitable.
 */
export const OUTPUT_META_SCHEMA = `{
    "definitions": {
        "schemaArray": {
            "type": "array",
            "minItems": 1,
            "items": {
                "$ref": "#"
            }
        },
        "nonNegativeInteger": {
            "type": "integer",
            "minimum": 0
        },
        "nonNegativeIntegerDefault0": {
            "allOf": [
                {
                    "$ref": "#/definitions/nonNegativeInteger"
                },
                {
                    "default": 0
                }
            ]
        },
        "simpleTypes": {
            "enum": [
                "array",
                "boolean",
                "integer",
                "null",
                "number",
                "object",
                "string"
            ]
        },
        "stringArray": {
            "type": "array",
            "items": {
                "type": "string"
            },
            "uniqueItems": true,
            "default": []
        }
    },
    "type": [
        "object",
        "boolean"
    ],
    "properties": {
        "$id": {
            "type": "string",
            "format": "uri-reference"
        },
        "$schema": {
            "type": "string",
            "format": "uri"
        },
        "$ref": {
            "type": "string",
            "format": "uri-reference"
        },
        "$comment": {
            "type": "string"
        },
        "title": {
            "type": "string"
        },
        "description": {
            "type": "string"
        },
        "default": true,
        "readOnly": {
            "type": "boolean",
            "default": false
        },
        "writeOnly": {
            "type": "boolean",
            "default": false
        },
        "examples": {
            "type": "array",
            "items": true
        },
        "multipleOf": {
            "type": "number",
            "exclusiveMinimum": 0
        },
        "maximum": {
            "type": "number"
        },
        "exclusiveMaximum": {
            "type": "number"
        },
        "minimum": {
            "type": "number"
        },
        "exclusiveMinimum": {
            "type": "number"
        },
        "maxLength": {
            "$ref": "#/definitions/nonNegativeInteger"
        },
        "minLength": {
            "$ref": "#/definitions/nonNegativeIntegerDefault0"
        },
        "pattern": {
            "type": "string",
            "format": "regex"
        },
        "additionalItems": {
            "$ref": "#"
        },
        "items": {
            "anyOf": [
                {
                    "$ref": "#"
                },
                {
                    "$ref": "#/definitions/schemaArray"
                }
            ],
            "default": true
        },
        "maxItems": {
            "$ref": "#/definitions/nonNegativeInteger"
        },
        "minItems": {
            "$ref": "#/definitions/nonNegativeIntegerDefault0"
        },
        "uniqueItems": {
            "type": "boolean",
            "default": false
        },
        "contains": {
            "$ref": "#"
        },
        "maxProperties": {
            "$ref": "#/definitions/nonNegativeInteger"
        },
        "minProperties": {
            "$ref": "#/definitions/nonNegativeIntegerDefault0"
        },
        "required": {
            "$ref": "#/definitions/stringArray"
        },
        "additionalProperties": {
            "$ref": "#"
        },
        "definitions": {
            "type": "object",
            "additionalProperties": {
                "$ref": "#"
            },
            "default": {}
        },
        "properties": {
            "type": "object",
            "additionalProperties": {
                "$ref": "#"
            },
            "default": {}
        },
        "patternProperties": {
            "type": "object",
            "additionalProperties": {
                "$ref": "#"
            },
            "propertyNames": {
                "format": "regex"
            },
            "default": {}
        },
        "dependencies": {
            "type": "object",
            "additionalProperties": {
                "anyOf": [
                    {
                        "$ref": "#"
                    },
                    {
                        "$ref": "#/definitions/stringArray"
                    }
                ]
            }
        },
        "propertyNames": {
            "$ref": "#"
        },
        "const": true,
        "enum": {
            "type": "array",
            "items": true,
            "minItems": 1,
            "uniqueItems": true
        },
        "type": {
            "anyOf": [
                {
                    "$ref": "#/definitions/simpleTypes"
                },
                {
                    "type": "array",
                    "items": {
                        "$ref": "#/definitions/simpleTypes"
                    },
                    "minItems": 1,
                    "uniqueItems": true
                }
            ]
        },
        "format": {
            "type": "string"
        },
        "contentMediaType": {
            "type": "string"
        },
        "contentEncoding": {
            "type": "string"
        },
        "if": {
            "$ref": "#"
        },
        "then": {
            "$ref": "#"
        },
        "else": {
            "$ref": "#"
        },
        "allOf": {
            "$ref": "#/definitions/schemaArray"
        },
        "anyOf": {
            "$ref": "#/definitions/schemaArray"
        },
        "oneOf": {
            "$ref": "#/definitions/schemaArray"
        },
        "not": {
            "$ref": "#"
        },
        "$defs": {
            "type": "object",
            "additionalProperties": {
                "$ref": "#"
            },
            "default": {}
        }
    },
    "default": true,
    "additionalProperties": false
}`

/** Keywords whose list of subschemas all apply to the same value as their parent. */
export const SAME_VALUE_LISTS: readonly string[] = ['allOf', 'anyOf', 'oneOf']

/** Keywords whose one subschema applies to the same value as its parent. */
export const SAME_VALUE_KEYWORDS: readonly string[] = ['not', 'if', 'then', 'else']

/** Keywords holding a map of named subschemas, each for a part of the value or a definition. */
export const SCHEMA_MAPS: readonly string[] = [
    'properties',
    'patternProperties',
    'dependencies',
    'definitions',
    '$defs',
]

/** Keywords whose one subschema applies to a part of the value, such as each item. */
export const CHILD_KEYWORDS: readonly string[] = [
    'additionalProperties',
    'items',
    'additionalItems',
    'contains',
    'propertyNames',
]
