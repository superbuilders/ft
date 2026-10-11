/**
 * Every file in a tests-tree `fakes/` directory declares who owns the
 * contract it substitutes, in its leading module docblock (root
 * `AGENTS.md`, "Glossary"):
 *
 *     @fake owned | platform | vendor
 *     @certifiedBy <repo-relative path>
 *
 * The class picks the fidelity obligation: `owned` fakes MUST name their
 * certification artifact (the contract suite, or wherever the real
 * counterpart is exercised) and every named path must RESOLVE to a
 * `*.test.ts` file — a renamed suite becomes a lint error here instead of
 * a sentence that silently lies, and a directory can't stand in for a
 * suite. The tag repeats: a fake certified slice-by-slice carries one
 * `@certifiedBy` per certifying suite, each checked. `platform` and
 * `vendor` fakes may name suites too; their backstop story (E2E, deployed
 * stages) stays prose in the docblock.
 * Contract suites (`*.test.ts`) colocated in `fakes/` are suites, not
 * fakes, and are exempt.
 */

import { statSync } from 'node:fs'
import { resolve } from 'node:path'

import { REPO_ROOT, repoRelativePath } from './lib.mjs'

const CONTRACTS = new Set(['owned', 'platform', 'vendor'])

/** The module's leading docblock, allowing only whitespace before it. */
const LEADING_DOCBLOCK = /^\s*\/\*\*([\s\S]*?)\*\//

export const fakesDeclareContract = {
    meta: {
        type: 'problem',
        messages: {
            undeclared:
                'A fake declares itself: the leading module docblock carries `@fake owned | platform | vendor` (the doubles glossary, AGENTS.md).',
            badContract:
                "@fake names who owns the substituted interface: 'owned' (this repo — needs a contract suite), 'platform' (a web standard — pin types, name the backstop), or 'vendor' (a third party — one seam, named backstop).",
            ownedNeedsCertification:
                'An owned fake names its certification artifact: add `@certifiedBy <repo-relative path>` pointing at the suite that exercises the real counterpart.',
            certificationMissing:
                'The @certifiedBy path does not exist in the repo — if the suite moved, move this pointer with it.',
            certificationNotSuite:
                'A @certifiedBy path names the `*.test.ts` suite that certifies this fake — a directory or non-test module cannot certify anything.',
        },
    },
    createOnce(context) {
        return {
            /**
             * Fires once per `fakes/` module missing or mis-declaring its
             * docblock tags.
             *
             * @param node - The file's Program node.
             */
            Program(node) {
                const rel = repoRelativePath(context.filename)

                if (
                    !/^(?:.*\/)?tests\/.*\bfakes\/[^/]+\.ts$/.test(rel) ||
                    rel.endsWith('.test.ts') ||
                    rel.endsWith('.d.ts')
                ) {
                    return
                }

                const header = LEADING_DOCBLOCK.exec(context.sourceCode.text)?.[1] ?? ''
                const fakeTag = /@fake\s+(\S+)/.exec(header)
                const certifiedBy = [...header.matchAll(/@certifiedBy\s+(\S+)/g)].map(
                    match => match[1],
                )

                if (!fakeTag) {
                    context.report({ node, messageId: 'undeclared' })

                    return
                }

                if (!CONTRACTS.has(fakeTag[1])) {
                    context.report({ node, messageId: 'badContract' })

                    return
                }

                if (fakeTag[1] === 'owned' && certifiedBy.length === 0) {
                    context.report({ node, messageId: 'ownedNeedsCertification' })

                    return
                }

                for (const suite of certifiedBy) {
                    if (!suite.endsWith('.test.ts')) {
                        context.report({ node, messageId: 'certificationNotSuite' })

                        continue
                    }

                    const absolute = resolve(REPO_ROOT, suite)

                    if (!statSync(absolute, { throwIfNoEntry: false })?.isFile()) {
                        context.report({ node, messageId: 'certificationMissing' })
                    }
                }
            },
        }
    },
}
