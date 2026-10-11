/**
 * Local oxlint plugin (loaded via `jsPlugins`) enforcing the console spacing
 * convention: vertical spacing around output is expressed as standalone
 * `console.log('')` / `console.error('')` calls, never as `\n` inlined at the
 * edges of the printed string. Mid-string newlines (multi-line content like
 * install hints) are fine — the rule polices spacing, not content.
 *
 * The fixer peels each edge `\n` off the literal and inserts one matching
 * `console.<method>('')` statement per newline on that side, preserving the
 * output stream. Reported without a fix: calls that aren't standalone
 * statements, multi-argument calls, and strings that are nothing but
 * newlines — what those mean is a human call.
 */

const CONSOLE_METHODS = new Set(['log', 'error', 'warn', 'info'])

/** Matches one or more escaped newlines (`\n` as two source characters). */
const LEADING_NEWLINES = /^(?:\\n)+/
const TRAILING_NEWLINES = /(?:\\n)+$/

const spacingNewlines = {
    meta: {
        type: 'layout',
        fixable: 'code',
        messages: {
            edgeNewline:
                "Spacing around console output is its own console.{{method}}('') call — don't inline \\n at the string edge.",
        },
    },
    create(context) {
        const { sourceCode } = context

        /**
         * The whitespace indent of the line a statement starts on, or null
         * when code precedes it on that line.
         *
         * @param start - Source offset of the statement.
         * @returns The indent string, or null.
         */
        function ownLineIndent(start) {
            const { text } = sourceCode
            let index = start

            while (index > 0 && text[index - 1] !== '\n') {
                index -= 1
            }

            const prefix = text.slice(index, start)

            return /^[ \t]*$/.test(prefix) ? prefix : null
        }

        /**
         * Checks a console call's single string argument for edge newlines
         * and reports each offending edge, with a fix when the call is a
         * standalone statement.
         *
         * @param node - The CallExpression to check.
         */
        function checkCall(node) {
            const { callee } = node

            if (
                callee.type !== 'MemberExpression' ||
                callee.computed ||
                callee.object.type !== 'Identifier' ||
                callee.object.name !== 'console' ||
                callee.property.type !== 'Identifier' ||
                !CONSOLE_METHODS.has(callee.property.name)
            ) {
                return
            }

            const method = callee.property.name
            const fixable = node.arguments.length === 1
            const [argument] = node.arguments

            if (
                argument === undefined ||
                (argument.type !== 'Literal' && argument.type !== 'TemplateLiteral') ||
                (argument.type === 'Literal' && typeof argument.value !== 'string')
            ) {
                return
            }

            // Text between the quotes/backticks; `\n` occupies two characters.
            const inner = sourceCode.getText(argument).slice(1, -1)
            const leading = LEADING_NEWLINES.exec(inner)
            const trailing = TRAILING_NEWLINES.exec(inner)

            if (leading === null && trailing === null) {
                return
            }

            const statement = node.parent
            const standalone = fixable && statement.type === 'ExpressionStatement'
            const indent = standalone ? ownLineIndent(statement.range[0]) : null
            const allNewlines =
                (leading?.[0].length ?? 0) + (trailing?.[0].length ?? 0) >= inner.length

            /**
             * Builds the fix for one edge: strip the escape characters from
             * the literal and insert one blank-printing call per newline on
             * the matching side of the statement.
             *
             * @param edge - Which edge of the string is being fixed.
             * @param length - Source length of the matched escape run.
             * @returns A fixer callback, or undefined when unfixable.
             */
            function edgeFix(edge, length) {
                if (indent === null || allNewlines) {
                    return undefined
                }

                return fixer => {
                    const blank = `console.${method}('')`
                    const count = length / 2
                    const [argStart, argEnd] = argument.range
                    const stripRange =
                        edge === 'leading'
                            ? [argStart + 1, argStart + 1 + length]
                            : [argEnd - 1 - length, argEnd - 1]
                    const insertion =
                        edge === 'leading'
                            ? fixer.insertTextBefore(statement, `${blank}\n${indent}`.repeat(count))
                            : fixer.insertTextAfter(statement, `\n${indent}${blank}`.repeat(count))

                    return [fixer.removeRange(stripRange), insertion]
                }
            }

            if (leading !== null) {
                context.report({
                    node: argument,
                    messageId: 'edgeNewline',
                    data: { method },
                    fix: edgeFix('leading', leading[0].length),
                })
            }

            if (trailing !== null && !allNewlines) {
                context.report({
                    node: argument,
                    messageId: 'edgeNewline',
                    data: { method },
                    fix: edgeFix('trailing', trailing[0].length),
                })
            }
        }

        return {
            CallExpression: checkCall,
        }
    },
}

export default {
    meta: { name: 'console-style' },
    rules: { 'spacing-newlines': spacingNewlines },
}
