import { expect, it } from 'vitest'

import { supportsTools } from './models'

it('marks only tool-free catalog models as unable to call tools', () => {
    expect(supportsTools('sonar-pro')).toBe(false)
    expect(supportsTools('gpt-6.1-sol')).toBe(true)
})
