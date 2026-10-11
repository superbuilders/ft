/**
 * Kind-files that never export types: `constants.ts` (values only),
 * `store.svelte.ts` (the factory; its public interface lives in `types.ts`),
 * and `queries.server.ts` (the query factory; its IO shapes live in
 * `types.ts` — FT-325).
 */

export const noTypeExports = {
    meta: {
        type: 'problem',
        messages: {
            typeExport:
                "Move this type to the feature's types.ts — this kind-file never exports types. If this file uses it, `import type { … } from './types'` after moving.",
        },
    },
    createOnce(context) {
        return {
            /**
             * Catches `export interface` / `export type X =`, `export type
             * { X }`, and per-specifier `export { type X }` forms.
             *
             * @param node - A named export declaration.
             */
            ExportNamedDeclaration(node) {
                const declaresType =
                    node.declaration?.type === 'TSTypeAliasDeclaration' ||
                    node.declaration?.type === 'TSInterfaceDeclaration'
                const reExportsType =
                    node.exportKind === 'type' ||
                    node.specifiers?.some(spec => spec.exportKind === 'type')

                if (declaresType || reExportsType) {
                    context.report({ node, messageId: 'typeExport' })
                }
            },
        }
    },
}
