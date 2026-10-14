import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

/**
 * Find the nearest worktree root by its .git directory or file, without invoking Git.
 * Paths stay lexical; callers enforcing canonical boundaries must resolve symlinks themselves.
 * @param cwd - directory to search from
 * @returns absolute repository root, or null when no ancestor has a .git entry
 */
export function repositoryRoot(cwd: string): string | null {
    for (let dir = resolve(cwd); ; dir = dirname(dir)) {
        if (existsSync(join(dir, '.git'))) {
            return dir
        }

        if (dirname(dir) === dir) {
            return null
        }
    }
}
