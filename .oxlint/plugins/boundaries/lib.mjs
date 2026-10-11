import { dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

/**
 * A lint target's path relative to the repo root, forward-slashed — the
 * one spelling the path-gated rules match their globs against, so they
 * can't drift into three approximations of the Windows `sep` fix.
 *
 * @param filename - The absolute path oxlint hands the rule.
 * @returns The repo-relative path with `/` separators.
 */
export function repoRelativePath(filename) {
    return relative(REPO_ROOT, resolve(filename)).split(sep).join('/')
}

/**
 * Visitor map covering every module-source edge — static imports, named and
 * wildcard re-exports, and dynamic `import()` — with one callback. Most
 * boundary rules inspect exactly these four node kinds; rules with extra
 * visitors spread this and add their own.
 *
 * @param check - Called with each node carrying a module source.
 * @returns The four-key visitor object `createOnce` returns.
 */
export function moduleSourceVisitors(check) {
    return {
        ImportDeclaration: check,
        ExportNamedDeclaration: check,
        ExportAllDeclaration: check,
        ImportExpression: check,
    }
}

/**
 * Whether an import/export declaration is erased at build: the declaration
 * itself is type-kind (`import type …` / `export type … from`). Per-specifier
 * type markers (`import { type X }`) don't count — under
 * `verbatimModuleSyntax` the statement survives as a side-effect import, so
 * only the declaration-level form is sanctioned.
 *
 * @param node - An import or re-export declaration.
 * @returns True when the whole declaration is type-only.
 */
export function isTypeOnly(node) {
    return (node.importKind ?? node.exportKind) === 'type'
}
