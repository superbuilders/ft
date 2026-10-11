/**
 * Every `tests/` tree shares one depth rule (root `AGENTS.md`,
 * "Test-support layout"): the `tests/` root holds the base Node project's
 * plumbing, each extra vitest project gets exactly one concern directory
 * (`workerd/`) whose own root holds only `env.d.ts` / `setup.ts` /
 * `actors.ts`, and everything else lives one level down in a role directory
 * from the closed set. A double's depth states which project it serves.
 * Historical offenders this rule exists for: a `helpers.ts` kitchen sink
 * (banned by name at any depth), a `mocks/` directory ("mock" is vitest's
 * word, never a directory name — root `AGENTS.md` glossary), and plumbing
 * files invented at a project dir's root instead of homed in a role.
 */

import { repoRelativePath } from './lib.mjs'

const ROLE_DIRS = new Set(['fakes', 'stubs', 'abilities', 'questions', 'tasks'])

/*
 * Each member is a plumbing KIND, not a free name: env typing, per-file
 * setup, per-run setup (vitest globalSetup), the cast, the project's
 * fixture harness, and the seed module (the db tree's doctrine).
 */
const PROJECT_ROOT_FILES = new Set([
    'env.d.ts',
    'setup.ts',
    'global-setup.ts',
    'actors.ts',
    'harness.ts',
    'seed.ts',
])

export const testsTreeLayout = {
    meta: {
        type: 'problem',
        messages: {
            mocksDir:
                '"mocks" is never a directory name — the house category is fakes/ (the doubles glossary, AGENTS.md).',
            kitchenSink:
                'No helpers.ts in a tests tree — home each helper in its role directory (fakes/, abilities/, questions/, tasks/).',
            projectRootMember: `A project directory's root holds only ${[...PROJECT_ROOT_FILES].join(', ')} — other plumbing lives one level down in a role directory (${[...ROLE_DIRS].join('/, ')}/).`,
            unknownRole:
                'Not a known role directory — the closed set is fakes/, stubs/, abilities/, questions/, tasks/ (root AGENTS.md, "Test-support layout").',
            tooDeep:
                'Role directories hold files, not subtrees — a member nested deeper than <project>/<role>/<file> has no home in the layout rule.',
        },
    },
    createOnce(context) {
        return {
            /**
             * Fires once per file whose path under a `tests/` tree
             * breaks the depth rule. The override glob bounds which files
             * pay the check; the path re-derivation keeps a stray glob from
             * misfiring elsewhere.
             *
             * @param node - The file's Program node.
             */
            Program(node) {
                const rel = repoRelativePath(context.filename)
                const match = /^(?:.*\/)?tests\/(.+)$/.exec(rel)

                if (!match?.[1]) {
                    return
                }

                const segments = match[1].split('/')
                const file = segments.at(-1) ?? ''

                if (segments.includes('mocks')) {
                    context.report({ node, messageId: 'mocksDir' })

                    return
                }

                if (file === 'helpers.ts') {
                    context.report({ node, messageId: 'kitchenSink' })

                    return
                }

                /* tests/ root: the Node project's plumbing, any file. */
                if (segments.length === 1) {
                    return
                }

                const first = segments[0] ?? ''

                /* A root-level role dir (the Node project's doubles): files only. */
                if (ROLE_DIRS.has(first)) {
                    if (segments.length !== 2) {
                        context.report({ node, messageId: 'tooDeep' })
                    }

                    return
                }

                /* Anything else at depth one is a project concern dir (workerd). */
                if (segments.length === 2) {
                    if (!PROJECT_ROOT_FILES.has(file)) {
                        context.report({ node, messageId: 'projectRootMember' })
                    }

                    return
                }

                if (segments.length === 3) {
                    if (!ROLE_DIRS.has(segments[1] ?? '')) {
                        context.report({ node, messageId: 'unknownRole' })
                    }

                    return
                }

                context.report({ node, messageId: 'tooDeep' })
            },
        }
    },
}
