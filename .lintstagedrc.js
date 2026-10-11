import { basename } from 'node:path'

/**
 * Quote literal paths without allowing shell interpolation.
 *
 * @param {string[]} paths - staged file paths
 * @returns {string} shell-safe, space-joined paths
 */
function quoted(paths) {
    return paths.map(file => `'${file.replaceAll("'", String.raw`'\''`)}'`).join(' ')
}

export default {
    /** Force-added ignored files must still be scanned; paths are literal. */
    '*': 'secretlint --no-glob --no-gitignore',

    /** Refuse real env files by name, not content; only example templates are allowed. */
    '**/.env*': files =>
        files.some(file => !file.endsWith('.example'))
            ? ['sh -c \'echo "refusing to commit a real env file" >&2; exit 1\'']
            : [],

    /** Canonical manifest key order must settle before the formatter runs. */
    '**/package.json': ['bunx sort-package-json', 'oxfmt --no-error-on-unmatched-pattern'],

    /** Pre-push owns type-aware lint; staged fixes settle before formatting. */
    '*.{js,mjs,cjs,jsx,ts,tsx,mts,cts}': [
        'oxlint --fix --no-error-on-unmatched-pattern',
        'oxfmt --no-error-on-unmatched-pattern',
    ],

    /** Exclude manifests to avoid racing their separate sort-then-format writer. */
    '*.{json,md,yml,yaml,toml}': files => {
        const rest = files.filter(file => basename(file) !== 'package.json')

        return rest.length === 0 ? [] : [`oxfmt --no-error-on-unmatched-pattern ${quoted(rest)}`]
    },
}
