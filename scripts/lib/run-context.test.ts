// Keep in sync with playcademy-arcade's run-context guard contract.

import { expect, test } from 'vitest'

import { fullGatesAllowed, unscopedTestRun } from './run-context'

test('full gates require a hook or CI, and local tests require a real path', () => {
    expect(fullGatesAllowed({})).toBe(false)
    expect(fullGatesAllowed({ CI: 'false' })).toBe(false)
    expect(fullGatesAllowed({ FT_HOOK: 'pre-commit' })).toBe(true)
    expect(fullGatesAllowed({ CI: 'true' })).toBe(true)
    expect(fullGatesAllowed({ CI: '1' })).toBe(false)
    expect(unscopedTestRun(['run'])).not.toBeNull()
    expect(unscopedTestRun(['run', '--root', '.'])).not.toBeNull()
    expect(unscopedTestRun(['run', '--project', 'scripts'])).not.toBeNull()
    expect(unscopedTestRun(['related', 'scripts/lib/run-context.ts'])).not.toBeNull()
    expect(unscopedTestRun(['run', 'scripts/lib/run-context.test.ts'])).toBeNull()
    expect(unscopedTestRun(['run', 'scripts/lib/run-context.test.ts:1'])).toBeNull()
    expect(unscopedTestRun(['list', '--filesOnly'])).toBeNull()
})
