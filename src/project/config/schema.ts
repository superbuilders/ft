import { Type } from 'typebox'
import { Compile } from 'typebox/compile'

import { KNOWN_APIS, THINKING_LEVELS } from '../../models/constants'

const EnvSchema = Type.Object(
    { env: Type.String({ pattern: '^[A-Za-z_][A-Za-z0-9_]*$' }) },
    { additionalProperties: false },
)

const KeySchema = Type.Union(
    [
        EnvSchema,
        Type.Object(
            { command: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }) },
            { additionalProperties: false },
        ),
    ],
    {
        description:
            'Where ft reads the credential: {"env": "NAME"}, or {"command": ["argv", ...]} run in the folder that holds this .ft.json. Never the credential itself.',
    },
)

const HeadersSchema = Type.Record(Type.String(), Type.String())

/* Nested Pi objects are left to Pi; ft checks every field's name and top-level type, so a typo fails here. */
const PiObject = Type.Record(Type.String(), Type.Unknown())

/** Pi's models.json model definition, plus ft's adapter; field names are tied to pi-ai's Model by a test. */
export const ModelSchema = Type.Object(
    {
        id: Type.String({ minLength: 1 }),
        adapter: Type.Optional(
            Type.String({
                minLength: 1,
                description:
                    "ft adapter that translates this model's traffic (ft ships: sonar). Requires the provider's baseUrl.",
            }),
        ),
        name: Type.Optional(Type.String({ minLength: 1 })),
        api: Type.Optional(Type.Enum(KNOWN_APIS)),
        baseUrl: Type.Optional(Type.String({ minLength: 1 })),
        reasoning: Type.Optional(Type.Boolean()),
        thinkingLevelMap: Type.Optional(PiObject),
        input: Type.Optional(Type.Array(Type.Enum(['text', 'image']))),
        inputLimits: Type.Optional(PiObject),
        cost: Type.Optional(PiObject),
        promptCache: Type.Optional(PiObject),
        contextWindow: Type.Optional(Type.Number()),
        maxTokens: Type.Optional(Type.Number()),
        samplingParams: Type.Optional(PiObject),
        samplingParamsByThinkingLevel: Type.Optional(PiObject),
        headers: Type.Optional(HeadersSchema),
        compat: Type.Optional(PiObject),
    },
    { additionalProperties: false },
)

const ProviderSchema = Type.Object(
    {
        key: KeySchema,
        baseUrl: Type.Optional(
            Type.Union([Type.String({ minLength: 1 }), EnvSchema], {
                description:
                    'Endpoint root including any version path (https://host/v1), or {"env": "NAME"} holding it. Required for a custom provider; overrides a built-in provider\'s endpoint.',
            }),
        ),
        api: Type.Optional(
            Type.Enum(KNOWN_APIS, {
                description: 'Wire protocol. Required for a custom provider.',
            }),
        ),
        name: Type.Optional(Type.String({ minLength: 1 })),
        headers: Type.Optional(HeadersSchema),
        authHeader: Type.Optional(Type.Boolean()),
        compat: Type.Optional(PiObject),
        models: Type.Optional(
            Type.Array(ModelSchema, {
                minItems: 1,
                description:
                    "Models in Pi's models.json format. Required for a custom provider; extra models for a built-in one.",
            }),
        ),
        modelOverrides: Type.Optional(Type.Record(Type.String(), PiObject)),
    },
    { additionalProperties: false },
)

const RoleSchema = Type.Object(
    {
        model: Type.String({
            minLength: 1,
            description: 'provider/model: a configured provider id and one of its model ids.',
        }),
        thinking: Type.Optional(Type.Enum(THINKING_LEVELS, { description: 'Pi thinking level.' })),
        description: Type.Optional(
            Type.String({
                minLength: 1,
                description: 'When to use this role, in a sentence; ft guide shows it to agents.',
            }),
        ),
    },
    { additionalProperties: false },
)

export const ConfigSchema = Type.Object(
    {
        $schema: Type.Optional(Type.String()),
        providers: Type.Record(Type.String({ pattern: '^[a-z0-9][a-z0-9-]*$' }), ProviderSchema, {
            description:
                'Providers by id. A Pi built-in id (anthropic, openai, openrouter, groq, ...) needs only key; any other id is a custom endpoint and needs key, baseUrl, api and models.',
        }),
        roles: Type.Record(Type.String({ minLength: 1 }), RoleSchema, {
            description: 'Named model choices for ft run --role. code is the default role.',
        }),
    },
    { additionalProperties: false },
)

export const configValidator = Compile(ConfigSchema)
