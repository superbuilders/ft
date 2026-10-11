import { expect, it } from 'vitest'

import manifest from '../../../package.json' with { type: 'json' }
import { PI_VERSION } from './constants'

it("types Pi's config with the release ft runs", () => {
    /* ft's provider and model types come from pi-ai; a mismatch would type-check against a different Pi. */
    expect(manifest.dependencies['@earendil-works/pi-ai']).toBe(PI_VERSION)
})
