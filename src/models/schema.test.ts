import { expectTypeOf, it } from 'vitest'

import type { Api, Model } from '@earendil-works/pi-ai'
import type { Static } from 'typebox'

import type { ModelSchema } from './schema'

it("names only model fields Pi's Model has, plus ft's adapter", () => {
    /* A field Pi lacks would be silently ignored by Pi; the schema is strict so a typo fails in ft instead. */
    expectTypeOf<
        Exclude<keyof Static<typeof ModelSchema>, keyof Model<Api> | 'adapter'>
    >().toEqualTypeOf<never>()
})
