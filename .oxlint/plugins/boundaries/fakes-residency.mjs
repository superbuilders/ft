/**
 * The third jaw of the fakes pincer (the doubles glossary, `AGENTS.md`).
 * `tests-tree-layout` shapes the tree, `fakes-declare-contract` makes
 * everything in a `fakes/` directory declare itself — and this rule
 * closes the remaining door: a declaration NAMED as a fake (`FakeRoom`,
 * `createFakeDb`, `fakeRepository`) may live in exactly two places, a
 * tests-tree `fakes/` directory (where the declaration rule reaches it)
 * or inline in a `*.test.ts` file (the doctrine's argument-passed
 * doubles). Anywhere else, the name is the confession: a shared double
 * has escaped the tree that certifies it. The naming doctrine — a double
 * is named by what it IS — is what makes the check possible; a fake
 * smuggled under a neutral name is review's job, not lint's.
 */

import { repoRelativePath } from './lib.mjs'

/** `FakeRoom`, `createFakeDb`, `fakeRepository` — never `breakfast`. */
const FAKE_NAME = /(^fake(?=[A-Z_]|$))|(^FAKE(?=_|$))|Fake/

export const fakesResidency = {
    meta: {
        type: 'problem',
        messages: {
            escaped:
                'A fake lives where its obligations reach it: shared doubles go in a tests-tree fakes/ directory (declared via @fake), and an argument-passed double stays inline in its *.test.ts (the doubles glossary, AGENTS.md).',
        },
    },
    createOnce(context) {
        /**
         * Whether this file may hold no fake-named declaration: a
         * governed app/service source file outside `fakes/` and the test
         * files. Read inside a visitor, since `context.filename` is not
         * available in `createOnce`.
         *
         * @returns True when a fake-named declaration here is an escape.
         */
        function governed() {
            const rel = repoRelativePath(context.filename)

            return (
                /^.+\.ts$/.test(rel) &&
                !rel.endsWith('.test.ts') &&
                !rel.endsWith('.d.ts') &&
                !/(?:^|\/)tests\/.*\bfakes\//.test(rel)
            )
        }

        /**
         * Report a fake-named declaration in a file that may hold none.
         *
         * @param node - A declaration node with an `id` identifier.
         */
        function check(node) {
            if (node.id?.type === 'Identifier' && FAKE_NAME.test(node.id.name) && governed()) {
                context.report({ node, messageId: 'escaped' })
            }
        }

        /**
         * Report a fake-named export binding — `export { x as FakeX }` and
         * `export * as FakeNs` mint bindings without a declaration `id`.
         *
         * @param node - An export specifier or star-export node.
         */
        function checkExported(node) {
            const name = node.exported?.type === 'Identifier' ? node.exported.name : undefined

            if (name !== undefined && FAKE_NAME.test(name) && governed()) {
                context.report({ node, messageId: 'escaped' })
            }
        }

        return {
            ClassDeclaration: check,
            FunctionDeclaration: check,
            TSInterfaceDeclaration: check,
            TSTypeAliasDeclaration: check,
            TSEnumDeclaration: check,
            TSModuleDeclaration: check,
            VariableDeclarator: check,
            ExportSpecifier: checkExported,
            ExportAllDeclaration: checkExported,
        }
    },
}
