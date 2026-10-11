import { expect, it } from 'vitest'

import { nextVersion } from './release'

it('bumps each part, accepts an exact version and refuses anything else', () => {
    expect(nextVersion('0.1.4', 'patch')).toBe('0.1.5')
    expect(nextVersion('0.1.4', 'minor')).toBe('0.2.0')
    expect(nextVersion('0.1.4', 'major')).toBe('1.0.0')
    expect(nextVersion('0.1.4', '0.1.4')).toBe('0.1.4')
    expect(() => nextVersion('0.1.4', 'v0.2')).toThrow()
})
