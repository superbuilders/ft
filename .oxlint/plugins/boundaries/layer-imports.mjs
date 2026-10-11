/**
 * Layered imports for the runner source. `.oxlint/boundaries/layers.json`
 * maps each folder (or root file) to the folders it may import from. A file
 * may always import from its own folder and that folder's subfolders; every
 * other source edge must land in a folder listed for the file's own folder or
 * any folder above it. Sibling folders are therefore isolated unless a map
 * entry names one, and a file in no mapped folder must be added to the map.
 */

import { readFileSync } from 'node:fs'
import { dirname, join, posix } from 'node:path'

import { moduleSourceVisitors, REPO_ROOT, repoRelativePath } from './lib.mjs'

const LAYERS = JSON.parse(readFileSync(join(REPO_ROOT, '.oxlint/boundaries/layers.json'), 'utf8'))

/**
 * Whether a source-relative path is a folder or file key, or lies under one.
 *
 * @param path - Source-relative path without extension.
 * @param key - A folder or root-file key from the layer map.
 * @returns True when the path is the key or inside it.
 */
function within(path, key) {
    return path === key || path.startsWith(`${key}/`)
}

/**
 * Strip a module extension so files and their extensionless imports compare equal.
 *
 * @param path - A source-relative path.
 * @returns The path without a trailing .ts or .mjs.
 */
function bare(path) {
    return path.replace(/\.(?:ts|mjs)$/, '')
}

export const layerImports = {
    meta: {
        type: 'problem',
        messages: {
            unknownLayer:
                '{{file}} is in no folder of .oxlint/boundaries/layers.json; add its folder and what it may import.',
            crossLayer:
                '{{file}} may not import {{target}}. Its layers allow: {{allowed}}. Move the code down a layer or add the edge to .oxlint/boundaries/layers.json.',
        },
    },
    createOnce(context) {
        return moduleSourceVisitors(node => {
            const specifier = node.source?.value

            if (typeof specifier !== 'string' || !specifier.startsWith('.')) {
                return
            }

            const relative = repoRelativePath(context.filename)
            const prefix = `${LAYERS.root}/`

            if (!relative.startsWith(prefix)) {
                return
            }

            const file = bare(relative.slice(prefix.length))
            const keys = Object.keys(LAYERS.allow).filter(key => within(file, key))

            if (keys.length === 0) {
                context.report({ node, messageId: 'unknownLayer', data: { file } })

                return
            }

            const target = posix.normalize(posix.join(posix.dirname(relative), specifier))

            if (!target.startsWith(prefix)) {
                return
            }

            const path = bare(target.slice(prefix.length))
            const folder = dirname(file)
            const allowed = keys.flatMap(key => LAYERS.allow[key])

            if (
                (folder !== '.' && within(path, folder)) ||
                allowed.some(key => within(path, key))
            ) {
                return
            }

            context.report({
                node,
                messageId: 'crossLayer',
                data: { file, target: path, allowed: allowed.join(', ') || 'nothing' },
            })
        })
    },
}
