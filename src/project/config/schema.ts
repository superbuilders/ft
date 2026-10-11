import { Type } from 'typebox'
import { Compile } from 'typebox/compile'

import { KNOWN_APIS, THINKING_LEVELS } from '../../models/constants'

const KeySchema = Type.Union([
    Type.Object(
        { env: Type.String({ pattern: '^[A-Za-z_][A-Za-z0-9_]*$' }) },
        { additionalProperties: false },
    ),
    Type.Object(
        { command: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }) },
        { additionalProperties: false },
    ),
])

/* Model and provider objects stay open: Pi validates its own fields when it loads models.json. */
const ModelSchema = Type.Object({
    id: Type.String({ minLength: 1 }),
    adapter: Type.Optional(Type.String({ minLength: 1 })),
})

const ProviderSchema = Type.Object({
    key: KeySchema,
    baseUrl: Type.Optional(Type.String({ minLength: 1 })),
    api: Type.Optional(Type.Enum(KNOWN_APIS)),
    models: Type.Optional(Type.Array(ModelSchema, { minItems: 1 })),
})

const LaneSchema = Type.Object(
    {
        model: Type.String({ minLength: 1 }),
        thinking: Type.Optional(Type.Enum(THINKING_LEVELS)),
    },
    { additionalProperties: false },
)

const ConfigSchema = Type.Object(
    {
        providers: Type.Record(Type.String({ pattern: '^[a-z0-9][a-z0-9-]*$' }), ProviderSchema),
        lanes: Type.Record(Type.String({ minLength: 1 }), LaneSchema),
    },
    { additionalProperties: false },
)

export const configValidator = Compile(ConfigSchema)
