/**
 * Local oxlint plugin (loaded via `jsPlugins`) enforcing the comment
 * convention for properties (FT-81). Two contexts, two shapes:
 *
 * - Field docs — interface members, class fields, and properties of object
 *   literals at module scope (zod schemas, pgTable columns, config) — are
 *   JSDoc (`double-star`), typically single-line, so they surface in IDE
 *   hover. Plain blocks and line comments promote.
 * - Code comments — properties of object literals inside a function body
 *   (runtime call arguments like `.set({ … })`) — use a multiline plain
 *   starred block, the repo's statement-position comment shape. They are
 *   commentary, not docs; JSDoc, single-line blocks, and line comments all
 *   rewrite to it.
 * - Function-valued properties (object-literal methods, config callbacks)
 *   are function-like, not fields: their docs are JSDoc in any context —
 *   they take the field-doc path even inside a function body.
 *
 * Type land is also exhaustive: every member of a named interface/type-alias
 * declaration carries a doc, and object-shaped declarations (interfaces,
 * `type X = { … }`) carry a multiline JSDoc above them. Exempt from the
 * REQUIREMENT: `Props` declarations, anonymous inline type literals, and
 * non-object aliases like `type Id = string` — but every declaration doc
 * that does exist must be multiline (single-line docs expand).
 *
 * Multiline comment blocks above a member are islands: a blank line above the
 * block (any multiline JSDoc, anywhere) and a blank line after the member it
 * documents (unless the member closes its bracket) — a heavy block butting
 * straight into the next one-liner member reads as unintentional.
 *
 * Fixers converge on the starred-block shapes
 * `@stylistic/multiline-comment-style` already validates. Trailing comments
 * (code before them on the same line) are reported without a fix — where the
 * comment should move is a human call.
 */

/*
 * Comments that are machine directives, not prose — rewriting them in any way
 * would silently disable them: TypeScript only honors `@ts-` directives in
 * line comments, and a block-form lint directive (oxlint-disable and friends)
 * must be the first token of a PLAIN block, so promoting one to JSDoc kills
 * it too. Applies to both line and block comments.
 */
const DIRECTIVE_COMMENT = /^\s*(?:@ts-|oxlint-|eslint-|prettier-)/

const FUNCTION_TYPES = new Set([
    'FunctionDeclaration',
    'FunctionExpression',
    'ArrowFunctionExpression',
])

/**
 * Whether a type declaration is a Svelte component's `Props` — exempt from the
 * exhaustiveness checks (per-property comments, declaration doc): prop names
 * are usually self-describing, and a forced comment invites the restating
 * kind. Shape rules still apply to any comment that is written.
 *
 * @param node - An interface or type-alias declaration.
 * @returns True for declarations named `Props`.
 */
function isPropsDeclaration(node) {
    return node.id?.name === 'Props'
}

/**
 * Whether a node sits inside a function body — the cut between runtime code
 * (multiline starred comments) and field docs (single-line ok). A concise
 * arrow return (`=> ({ … })`) is transparent: the object IS the declaration
 * (drizzle `relations` edges, config factories), there's no body of
 * statements around it.
 *
 * @param node - The AST node to walk up from.
 * @returns True when any ancestor is a function with a real body.
 */
function isInsideFunctionBody(node) {
    let child = node

    for (let current = node.parent; current; current = current.parent) {
        if (FUNCTION_TYPES.has(current.type)) {
            const conciseReturn =
                current.type === 'ArrowFunctionExpression' &&
                current.body === child &&
                child.type !== 'BlockStatement'

            if (!conciseReturn) {
                return true
            }
        }

        child = current
    }

    return false
}

/**
 * The named type declaration a member belongs to, walking out through nested
 * type literals. Null for members of anonymous inline literals (annotations
 * like `Record<K, { a: string }>`), which the exhaustiveness check leaves
 * alone.
 *
 * @param node - A TSPropertySignature.
 * @returns The enclosing interface/type-alias declaration, or null.
 */
function enclosingTypeDeclaration(node) {
    for (let current = node.parent; current; current = current.parent) {
        if (
            current.type === 'TSInterfaceDeclaration' ||
            current.type === 'TSTypeAliasDeclaration'
        ) {
            return current
        }

        if (
            current.type !== 'TSTypeLiteral' &&
            current.type !== 'TSPropertySignature' &&
            current.type !== 'TSInterfaceBody'
        ) {
            return null
        }
    }

    return null
}

const propertyComments = {
    meta: {
        type: 'layout',
        fixable: 'code',
        messages: {
            fieldDocShape:
                'Make this a /** … */ doc on its own line above the member — plain /* */ and // don’t surface in IDE hover.',
            starredInCode:
                'Write this as a multiline starred /* */ block on its own line above the property — inside a function body a comment is commentary, not a doc.',
            missingPropertyComment:
                'Add a /** … */ doc above this property. Say what the code can’t: where the value comes from, its units or constraints, who consumes it — not a restatement of the property name.',
            missingDeclarationDoc:
                'Add a multiline /** */ doc above this declaration (opener, ` * ` body lines, closer). Say what it represents and the role it plays — not a restatement of its name.',
            expandDeclarationDoc:
                'Expand this doc onto multiple lines (opener, ` * ` body lines, closer) — declaration docs are always multiline.',
            blankBeforeDoc: 'Insert a blank line above this doc block.',
            blankAfterDoc:
                'Insert a blank line after this member — a multiline comment block is an island, with air above and below.',
        },
    },
    create(context) {
        const { sourceCode } = context

        /**
         * The whitespace indent of the line a comment starts on, or null when
         * code precedes the comment on that line (a trailing comment).
         *
         * @param commentStart - Source offset of the comment opener.
         * @returns The indent string, or null for trailing comments.
         */
        function ownLineIndent(commentStart) {
            const { text } = sourceCode
            let index = commentStart

            while (index > 0 && text[index - 1] !== '\n') {
                index -= 1
            }

            const prefix = text.slice(index, commentStart)

            return /^[ \t]*$/.test(prefix) ? prefix : null
        }

        /**
         * Reports (and rewrites) a leading property comment in a field-doc
         * context, where the sanctioned shape is JSDoc (it surfaces in IDE
         * hover): a plain block promotes its opener, a line comment becomes a
         * single-line JSDoc.
         *
         * @param comment - The comment to check.
         */
        function checkFieldDocComment(comment) {
            if (comment.type === 'Block' && !comment.value.startsWith('*')) {
                context.report({
                    loc: comment.loc,
                    messageId: 'fieldDocShape',
                    fix(fixer) {
                        const [start] = comment.range

                        return fixer.replaceTextRange([start, start + 2], '/**')
                    },
                })
            }

            if (comment.type === 'Line') {
                context.report({
                    loc: comment.loc,
                    messageId: 'fieldDocShape',
                    fix(fixer) {
                        const text = comment.value.trim()

                        return fixer.replaceTextRange(
                            comment.range,
                            text === '' ? '/** */' : `/** ${text} */`,
                        )
                    },
                })
            }
        }

        /**
         * Reports (and rewrites) a leading property comment in a function
         * body, where the only sanctioned shape is a multiline starred block.
         * Multiline JSDoc just demotes its opener; single-line comments of any
         * kind expand in place when they sit alone on their line.
         *
         * @param comment - The comment to check.
         */
        function checkRuntimeComment(comment) {
            const multiline = comment.loc.start.line !== comment.loc.end.line

            if (comment.type === 'Block' && !comment.value.startsWith('*') && multiline) {
                return
            }

            if (comment.type === 'Block' && comment.value.startsWith('*') && multiline) {
                context.report({
                    loc: comment.loc,
                    messageId: 'starredInCode',
                    fix(fixer) {
                        const [start] = comment.range

                        return fixer.replaceTextRange([start, start + 3], '/*')
                    },
                })

                return
            }

            const text =
                comment.type === 'Line'
                    ? comment.value.trim()
                    : comment.value.replace(/^\*/, '').trim()
            const indent = ownLineIndent(comment.range[0])

            context.report({
                loc: comment.loc,
                messageId: 'starredInCode',
                fix:
                    indent === null || text === ''
                        ? undefined
                        : fixer =>
                              fixer.replaceTextRange(
                                  comment.range,
                                  `/*\n${indent} * ${text}\n${indent} */`,
                              ),
            })
        }

        /**
         * Requires a blank line after a member whose leading comment block is
         * multiline, completing the island the blank-above rule starts — a
         * heavy block's member butting straight into the next one-liner reads
         * as unintentional. Exempt: a member that closes its bracket (the next
         * line is only `}`/`]`/`)` punctuation) and end of file.
         *
         * @param node - The member the multiline block documents.
         * @param comment - The multiline block, for the report location.
         */
        function checkBlankAfterDoc(node, comment) {
            const { text } = sourceCode
            const newlineAfter = text.indexOf('\n', node.range[1])

            if (newlineAfter === -1) {
                return
            }

            const nextLineStart = newlineAfter + 1
            const nextLineEnd = text.indexOf('\n', nextLineStart)
            const nextLine = text
                .slice(nextLineStart, nextLineEnd === -1 ? text.length : nextLineEnd)
                .trim()

            if (nextLine === '' || /^[}\])]/.test(nextLine)) {
                return
            }

            context.report({
                loc: comment.loc,
                messageId: 'blankAfterDoc',
                fix(fixer) {
                    return fixer.replaceTextRange([nextLineStart, nextLineStart], '\n')
                },
            })
        }

        /**
         * Dispatches each leading comment of a property-like node to the
         * check for its context. A function-valued property (object-literal
         * method, config callback) is function-like, not a field — its doc is
         * JSDoc in ANY context, so it always takes the field-doc path and is
         * never demoted by the runtime rules. Interface and type-literal
         * members must also HAVE a comment — a bare property is an error (no
         * fixer; the content is a human job).
         *
         * @param node - The property node whose leading comments are checked.
         */
        function checkLeadingComments(node) {
            const methodLike =
                node.type === 'Property' &&
                (node.value.type === 'FunctionExpression' ||
                    node.value.type === 'ArrowFunctionExpression')
            const runtime = node.type === 'Property' && !methodLike && isInsideFunctionBody(node)
            let prose = 0
            let multilineDoc = null

            for (const comment of sourceCode.getCommentsBefore(node)) {
                if (DIRECTIVE_COMMENT.test(comment.value)) {
                    continue
                }

                prose += 1

                if (comment.loc.start.line !== comment.loc.end.line) {
                    multilineDoc = comment
                }

                if (runtime) {
                    checkRuntimeComment(comment)
                } else {
                    checkFieldDocComment(comment)
                }
            }

            if (multilineDoc !== null) {
                checkBlankAfterDoc(node, multilineDoc)
            }

            if (node.type === 'TSPropertySignature' && prose === 0) {
                const declaration = enclosingTypeDeclaration(node)

                if (declaration !== null && !isPropsDeclaration(declaration)) {
                    context.report({ loc: node.loc, messageId: 'missingPropertyComment' })
                }
            }
        }

        /**
         * Checks the JSDoc doc above an interface or type-alias declaration
         * (on the `export` wrapper when present, where the doc attaches). The
         * doc is the LAST JSDoc block among the leading comments — directive
         * lines or banners between it and the declaration don't shadow it
         * (TypeScript attaches the doc through such trivia too). A doc is
         * REQUIRED only on object-shaped, non-`Props` declarations; but any
         * declaration doc that exists — including on `Props` and non-object
         * aliases like `type Id = string` — must be multiline, and a
         * single-line one expands in place. Missing reports without a fix
         * (required declarations only).
         *
         * @param node - The interface or type-alias declaration.
         */
        function checkDeclarationDoc(node) {
            const required =
                !isPropsDeclaration(node) &&
                !(
                    node.type === 'TSTypeAliasDeclaration' &&
                    node.typeAnnotation.type !== 'TSTypeLiteral'
                )
            const target = node.parent.type === 'ExportNamedDeclaration' ? node.parent : node
            const doc = sourceCode
                .getCommentsBefore(target)
                .findLast(c => c.type === 'Block' && c.value.startsWith('*'))

            if (doc === undefined) {
                if (required) {
                    context.report({
                        loc: node.id?.loc ?? node.loc,
                        messageId: 'missingDeclarationDoc',
                    })
                }

                return
            }

            if (doc.loc.start.line !== doc.loc.end.line) {
                return
            }

            const text = doc.value.replace(/^\*/, '').trim()
            const indent = ownLineIndent(doc.range[0])

            context.report({
                loc: doc.loc,
                messageId: 'expandDeclarationDoc',
                fix:
                    indent === null
                        ? undefined
                        : fixer =>
                              fixer.replaceTextRange(
                                  doc.range,
                                  `/**\n${indent} * ${text}\n${indent} */`,
                              ),
            })
        }

        /**
         * Requires a blank line before every multiline JSDoc block, so heavy
         * docs never butt up against the previous statement. Exempt: file
         * start, a preceding blank line, an opening bracket (first member of
         * a block), or another comment directly above. Implemented here
         * rather than via `jsdoc-ext/lines-before-block` because that rule
         * drops diagnostics in multi-threaded oxlint runs.
         */
        function checkBlankBeforeDocs() {
            const { text } = sourceCode

            for (const comment of sourceCode.getAllComments()) {
                if (
                    comment.type !== 'Block' ||
                    !comment.value.startsWith('*') ||
                    comment.loc.start.line === comment.loc.end.line
                ) {
                    continue
                }

                const indent = ownLineIndent(comment.range[0])

                if (indent === null) {
                    continue
                }

                const lineStart = comment.range[0] - indent.length

                if (lineStart === 0) {
                    continue
                }

                const prevLineEnd = lineStart - 1
                const prevLineStart = text.lastIndexOf('\n', prevLineEnd - 1) + 1
                const prevLine = text.slice(prevLineStart, prevLineEnd).trim()
                const isClear =
                    prevLine === '' ||
                    /[[({]$/.test(prevLine) ||
                    prevLine.endsWith('*/') ||
                    prevLine.startsWith('//') ||
                    prevLine.startsWith('*')

                if (!isClear) {
                    context.report({
                        loc: comment.loc,
                        messageId: 'blankBeforeDoc',
                        fix(fixer) {
                            return fixer.replaceTextRange([lineStart, lineStart], '\n')
                        },
                    })
                }
            }
        }

        return {
            Program: checkBlankBeforeDocs,
            TSPropertySignature: checkLeadingComments,
            TSInterfaceDeclaration: checkDeclarationDoc,
            TSTypeAliasDeclaration: checkDeclarationDoc,
            PropertyDefinition: checkLeadingComments,
            Property: checkLeadingComments,
        }
    },
}

export default {
    meta: { name: 'comment-style' },
    rules: { 'property-comments': propertyComments },
}
