import { Type } from 'typebox'
import { Compile } from 'typebox/compile'

import { ProviderSchema, RoleSchema } from '../../models/schema'

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
        runs: Type.Optional(
            Type.Object(
                {
                    keepDays: Type.Optional(
                        Type.Integer({
                            minimum: 0,
                            description:
                                'Days a finished run is kept. Each new run deletes older ones; 0 keeps every run. Default 14.',
                        }),
                    ),
                },
                { additionalProperties: false, description: 'What ft keeps of past runs.' },
            ),
        ),
    },
    { additionalProperties: false },
)

export const configValidator = Compile(ConfigSchema)
