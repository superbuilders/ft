import { expect, it } from 'vitest'

import { platformTarget } from './host'

it('maps only supported platform targets', () => {
    expect(platformTarget('linux', 'arm64')).toBe('linux-arm64')
    expect(() => platformTarget('win32', 'x64')).toThrow('Unsupported platform')
})
