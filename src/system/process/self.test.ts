import { describe, expect, it } from 'vitest'

import { invocation, spelled } from './self'

describe('invocation', () => {
    it('names a package script by its package manager', () => {
        expect(
            invocation({ npm_lifecycle_event: 'ft', npm_config_user_agent: 'bun/1.3.13 npm/?' }),
        ).toBe('bun ft')
        expect(invocation({ npm_lifecycle_event: 'ft', npm_config_user_agent: 'npm/10.0.0' })).toBe(
            'npm run ft',
        )
    })

    it('names a launcher inside the repository by its path, and PATH as plain ft', () => {
        expect(invocation({ FT_LAUNCHER: '.ft/ft' })).toBe('.ft/ft')
        expect(invocation({ FT_LAUNCHER: '/home/me/.local/bin/ft' })).toBe('ft')
        expect(invocation({})).toBe('ft')
    })
})

describe('spelled', () => {
    it('rewrites ft commands and leaves other text alone', () => {
        expect(spelled('Collect it with: ft watch abc. `ft show abc` says more.', 'bun ft')).toBe(
            'Collect it with: bun ft watch abc. `bun ft show abc` says more.',
        )
        expect(spelled('ft runs one brief; draft watch', 'bun ft')).toBe(
            'ft runs one brief; draft watch',
        )
    })
})
