import { existsSync } from 'node:fs'

import { SUBCOMMANDS, VALUE_OPTIONS } from './vitest-options.ts'

/**
 * Whether the full quality gates may run in this environment.
 *
 * @param env - environment record, normally process.env
 * @returns true inside a git hook or CI
 */
export function fullGatesAllowed(env: Record<string, string | undefined>): boolean {
    return Boolean(env.FT_HOOK) || env.CI === 'true'
}

/**
 * Why a vitest invocation is refused outside the hooks, or null when it may
 * run: it names test files or directories (optionally with `--project`), or
 * it only lists files. A token counts as named only if it exists on disk
 * (minus vitest's `:<line>` filter suffix), so an unlisted option's value
 * (`--retry 1`) never passes for a path. `related` names source files, not tests, and one
 * widely imported module selects most of the suite, so it is refused too.
 *
 * @param args - vitest's arguments, after the `vitest` binary
 * @returns the refusal reason, or null when the run is scoped
 */
export function unscopedTestRun(args: readonly string[]): string | null {
    const [first, ...rest] = args
    const subcommand = first !== undefined && SUBCOMMANDS.has(first) ? first : undefined
    const tokens = subcommand === undefined ? args : rest

    if (subcommand === 'list') {
        return null
    }

    if (subcommand === 'related') {
        return '`vitest related` runs every test that imports the named source files, which can be most of the suite'
    }

    let named = false

    for (let index = 0; index < tokens.length; index++) {
        const token = tokens[index]

        if (token.startsWith('-')) {
            if (VALUE_OPTIONS.has(token)) {
                index++
            }

            continue
        }

        if (existsSync(token.replace(/:\d+$/, ''))) {
            named = true
        }
    }

    if (named) {
        return null
    }

    return 'no test files or directories were named'
}

/**
 * Guidance for an unscoped test invocation outside hooks and CI.
 *
 * @param reason - the rule the invocation broke
 * @returns the refusal message
 */
export function testRefusal(reason: string): string {
    return `Tests not run: ${reason}.

Unscoped tests run only inside the git hooks and CI. CI runs the full suite
on every pull request; while working, name the tests for the code you changed:
  bun run test <files>
  bun run test scripts/lib/run-context.test.ts
  bunx vitest list --filesOnly

A --project or -t filter without paths still loads the whole suite.`
}

/**
 * Guidance for a full check invocation outside hooks and CI.
 *
 * @returns the refusal message
 */
export function checkRefusal(): string {
    return `Checks not run: \`bun run check\` runs only inside the git hooks and CI.

The commit hook lints and formats staged files; the push hook runs typecheck,
type-aware lint and knip. Running the gate first duplicates that work.
While working, run:
  bun run typecheck
  bun run test <files>

Commit and push when ready; the hooks run the rest and CI runs the full suite.`
}
