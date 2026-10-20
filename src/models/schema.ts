import { Type } from 'typebox'

import {
    DEFAULT_COMPACT_AT,
    KNOWN_APIS,
    MIN_COMPACT_AT,
    PI_KEEP_RECENT_TOKENS,
    THINKING_LEVELS,
} from './constants'

const EnvSchema = Type.Object(
    { env: Type.String({ pattern: '^[A-Za-z_][A-Za-z0-9_]*$' }) },
    { additionalProperties: false },
)

export const KeySchema = Type.Union(
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
        compactAt: Type.Optional(
            Type.Integer({
                minimum: MIN_COMPACT_AT,
                description: `Tokens of conversation at which Pi summarizes older turns to keep the run going (default ${DEFAULT_COMPACT_AT}, at least ${MIN_COMPACT_AT}: Pi keeps the latest ${PI_KEEP_RECENT_TOKENS} tokens word for word, so a lower value would compact every turn). ft never compacts later than the context window allows.`,
            }),
        ),
        maxTokens: Type.Optional(Type.Number()),
        samplingParams: Type.Optional(PiObject),
        samplingParamsByThinkingLevel: Type.Optional(PiObject),
        headers: Type.Optional(HeadersSchema),
        compat: Type.Optional(PiObject),
    },
    { additionalProperties: false },
)

export const ProviderSchema = Type.Object(
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

export const RoleSchema = Type.Object(
    {
        model: Type.String({
            minLength: 1,
            description: 'provider/model: a configured provider id and one of its model ids.',
        }),
        thinking: Type.Optional(Type.Enum(THINKING_LEVELS, { description: 'Pi thinking level.' })),
        maxTurns: Type.Optional(
            Type.Integer({
                minimum: 1,
                description:
                    'Stop a run when the model starts more turns than this; --max-turns overrides it. Default: no limit.',
            }),
        ),
        description: Type.Optional(
            Type.String({
                minLength: 1,
                description: 'When to use this role, in a sentence; ft guide shows it to agents.',
            }),
        ),
    },
    { additionalProperties: false },
)
