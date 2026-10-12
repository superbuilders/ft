import { defineConfig } from 'vitest/config'

import { fullGatesAllowed, testRefusal, unscopedTestRun } from './scripts/lib/run-context.ts'

/**
 * Guard only the CLI; editor API callers have their own file-selection contract.
 */
function guardTestRun() {
    const [, bin, ...args] = process.argv

    if (!bin?.includes('vitest') || fullGatesAllowed(process.env)) {
        return
    }

    const reason = unscopedTestRun(args)

    if (reason !== null) {
        console.error(testRefusal(reason))
        process.exit(1)
    }
}

guardTestRun()

export default defineConfig({
    test: {
        include: ['**/*.test.ts'],
        exclude: ['**/node_modules/**'],
        silent: 'passed-only',
        /** Tests never read the developer's personal ft config. */
        env: { XDG_CONFIG_HOME: '/nonexistent/ft-tests-config' },
    },
})
