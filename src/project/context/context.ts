import { existsSync } from 'node:fs'
import { readFile, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

import { commandOutput } from '../../system/process/subprocess'

/**
 * Determine whether a path stays inside the permitted context boundary.
 * @param root - context root
 * @param path - candidate
 * @returns whether the candidate is within root
 */
function within(root: string, path: string): boolean {
    const suffix = relative(root, path)

    return suffix !== '..' && !suffix.startsWith(`..${sep}`) && !isAbsolute(suffix)
}

/**
 * Resolve import-only Claude instructions without escaping the project boundary or looping.
 * @param path - selected instruction file
 * @param root - allowed context boundary
 * @param seen - files already expanded
 * @returns instruction text with source labels
 */
async function instruction(path: string, root: string, seen: Set<string>): Promise<string> {
    const canonical = await realpath(path)

    if (!within(root, canonical)) {
        throw new Error(`context import escapes the project root: ${path}`)
    }

    if (seen.has(canonical)) {
        return ''
    }

    seen.add(canonical)

    const text = await readFile(canonical, 'utf8')
    const lines = text
        .trim()
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)

    if (
        /^CLAUDE\.md$/i.test(path.split(sep).at(-1) ?? '') &&
        lines.length > 0 &&
        lines.every(line => /^@\S+$/.test(line))
    ) {
        const imports = await Promise.all(
            lines.map(line => instruction(resolve(dirname(path), line.slice(1)), root, seen)),
        )

        return imports.join('\n\n')
    }

    return `# Instructions from ${path}\n\n${text}`
}

/**
 * Collect one context file per directory from git root (or the workspace) through cwd.
 * @param projectRoot - the run's workspace, used when cwd is not in a git repository
 * @param cwd - run directory
 * @returns root-to-leaf instruction text
 */
export async function collectContext(projectRoot: string, cwd: string): Promise<string> {
    const runCwd = await realpath(cwd)
    const gitRoot = await commandOutput([
        'git',
        '-C',
        runCwd,
        'rev-parse',
        '--show-toplevel',
    ]).catch(() => '')
    const root = await realpath(gitRoot.trim() || projectRoot)

    if (!within(root, runCwd)) {
        throw new Error(`run directory ${runCwd} is outside the project root ${root}`)
    }

    const directories: string[] = []

    for (let dir = runCwd; ; dir = dirname(dir)) {
        directories.unshift(dir)

        if (dir === root) {
            break
        }
    }

    const parts: string[] = []
    const seen = new Set<string>()

    for (const dir of directories) {
        const selected = ['AGENTS.override.md', 'AGENTS.md', 'AGENTS.MD', 'CLAUDE.md', 'CLAUDE.MD']
            .map(name => join(dir, name))
            .find(path => existsSync(path))

        if (selected) {
            parts.push(await instruction(selected, root, seen))
        }
    }

    return parts.join('\n\n')
}
