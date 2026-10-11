/**
 * A `constants.ts` kind-file holds pure values — literals and as-const
 * derivations; type-only imports are the one sanctioned edge. Two failure
 * modes, one invariant: a runtime import chains the file to whatever it
 * loads, and a construction (`new URLPattern(...)`, a call) runs at import
 * time and can bind the file to one runtime's globals — realtime's
 * play/constants.ts built five URLPatterns at top level and took the whole
 * lease test suite down on any Node < 23.8 before a single test ran. Pure
 * modules built on constants must stay importable in every runtime; runtime
 * objects live with their runtime-side consumers (a patterns.ts, a utils.ts).
 */

import { isTypeOnly, moduleSourceVisitors } from './lib.mjs'

export const noImpureConstants = {
    meta: {
        type: 'problem',
        messages: {
            runtimeImport:
                'constants.ts must not import at runtime — change this to `import type { … }` (not `import { type … }`). If a constant needs this value, move that constant out (to the consuming module or the feature’s utils.ts) instead.',
            construction:
                'constants.ts holds pure values — literals and as-const derivations. A construction or call runs at import time and can bind the file to one runtime’s globals (new URLPattern took the realtime suite down on Node < 23.8); move the built object to a module its runtime-side consumers import (patterns.ts, utils.ts).',
        },
    },
    createOnce(context) {
        /**
         * Reports anything that loads a module at runtime — plain imports,
         * re-exports with a source (`export { x } from`, `export * from`),
         * and dynamic `import()`, which import just the same.
         *
         * @param node - An import, named re-export, `export *`, or dynamic
         *   `import()` node.
         */
        function checkRuntimeEdge(node) {
            if (node.source && !isTypeOnly(node)) {
                context.report({ node, messageId: 'runtimeImport' })
            }
        }

        /**
         * Reports any construction or call — a pure-values file has none
         * anywhere, so no scope tracking is needed.
         *
         * @param node - A `new X(...)` or `f(...)` expression node.
         */
        function checkConstruction(node) {
            context.report({ node, messageId: 'construction' })
        }

        return {
            ...moduleSourceVisitors(checkRuntimeEdge),
            NewExpression: checkConstruction,
            CallExpression: checkConstruction,
        }
    },
}
