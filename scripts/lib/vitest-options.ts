/**
 * Vitest options that consume the next token, so their values are never read
 * as test paths, even when the value exists on disk (`--root ../..`).
 */
export const VALUE_OPTIONS = new Set([
    '-c',
    '--config',
    '-r',
    '--root',
    '--dir',
    '-t',
    '--testNamePattern',
    '--project',
    '--reporter',
    '--outputFile',
    '--shard',
    '--pool',
    '--environment',
    '--maxWorkers',
    '--changed',
])

/** Vitest subcommands; a bare `vitest` is watch mode over everything. */
export const SUBCOMMANDS = new Set(['run', 'watch', 'dev', 'related', 'bench', 'list'])
