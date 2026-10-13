import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { hostname } from 'node:os'
import { basename, extname, join } from 'node:path'

import { atomicWrite } from '../../system/files/atomic-write'
import { commandName } from '../../system/process/self'
import {
    DEFAULT_RUN_NAME,
    ID_NAME_MAX,
    ID_SUFFIX_LENGTH,
    RUN_FILES,
    RUNS_DIR,
    RUNS_GITIGNORE,
    TITLE_MAX,
} from './constants'

import type { Progress, Request, State, Status } from './types'

/**
 * The project's runs folder.
 * @param root - project root, the directory holding .ft.json
 * @returns absolute runs folder
 */
function runsRoot(root: string): string {
    return join(root, RUNS_DIR)
}

/**
 * Choose the readable part of a run id: the caller's name, else the brief file's name.
 * @param name - the caller's --name, if any
 * @param brief - the brief path, or `-` for stdin
 * @returns lowercase letters, digits and dashes
 */
export function runName(name: string | undefined, brief: string): string {
    const source = name ?? (brief === '-' ? '' : basename(brief, extname(brief)))
    const slug = source
        .toLowerCase()
        .replaceAll(/[^a-z0-9]+/g, '-')
        .replaceAll(/^-+|-+$/g, '')
        .slice(0, ID_NAME_MAX)
        .replace(/-+$/, '')

    return slug || DEFAULT_RUN_NAME
}

/**
 * Take a list title from the brief: its first line that says something, without markup.
 * @param brief - brief text
 * @returns one short line
 */
export function briefTitle(brief: string): string {
    for (const line of brief.split('\n')) {
        const text = line
            .replaceAll(/<\/?[\w-]+>/g, '')
            .replace(/^#+\s*/, '')
            .trim()

        if (text) {
            return text.length > TITLE_MAX ? `${text.slice(0, TITLE_MAX - 1)}…` : text
        }
    }

    return ''
}

/**
 * A fresh, empty progress record.
 * @returns zeroed progress
 */
export function emptyProgress(): Progress {
    return {
        turns: 0,
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
        tools: {},
        files: [],
        activity: null,
    }
}

/**
 * Make a run's folder under a new id, retrying on the rare collision.
 * @param root - project root
 * @param name - readable part of the id
 * @returns the id and absolute folder
 */
export async function createRun(root: string, name: string): Promise<{ id: string; dir: string }> {
    const runs = runsRoot(root)

    await mkdir(runs, { recursive: true })

    if (!existsSync(join(runs, '.gitignore'))) {
        await writeFile(join(runs, '.gitignore'), RUNS_GITIGNORE)
    }

    for (;;) {
        const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, ID_SUFFIX_LENGTH)
        const id = `${name}-${suffix}`
        const dir = join(runs, id)

        try {
            await mkdir(dir, { mode: 0o700 })

            return { id, dir }
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
                throw error
            }
        }
    }
}

/**
 * Persist the caller's request beside the run.
 * @param dir - run folder
 * @param request - what to run
 * @returns completion
 */
export async function writeRequest(dir: string, request: Request): Promise<void> {
    await atomicWrite(join(dir, RUN_FILES.request), `${JSON.stringify(request, null, 4)}\n`)
}

/**
 * Read the request a run was started with.
 * @param dir - run folder
 * @returns the stored request
 */
export async function readRequest(dir: string): Promise<Request> {
    return JSON.parse(await readFile(join(dir, RUN_FILES.request), 'utf8')) as Request
}

/**
 * Publish the run's status atomically, so a reader never sees half a file.
 * @param status - current snapshot
 * @returns completion
 */
export async function writeStatus(status: Status): Promise<void> {
    status.updatedAt = new Date().toISOString()
    await atomicWrite(join(status.dir, RUN_FILES.status), `${JSON.stringify(status, null, 4)}\n`)
}

/**
 * Read a run's status, if it has one yet.
 * @param dir - run folder
 * @returns the status, or null before the run wrote one
 */
export async function readStatus(dir: string): Promise<Status | null> {
    try {
        return JSON.parse(await readFile(join(dir, RUN_FILES.status), 'utf8')) as Status
    } catch {
        return null
    }
}

/**
 * Tell a working run from one whose process died without writing a verdict.
 * @param status - stored status
 * @returns `lost` for a dead running run, else the stored outcome
 */
export function stateOf(status: Status): State {
    if (status.outcome !== 'running' || status.pid === null || status.host !== hostname()) {
        return status.outcome
    }

    try {
        process.kill(status.pid, 0)

        return 'running'
    } catch (error) {
        return (error as NodeJS.ErrnoException).code === 'EPERM' ? 'running' : 'lost'
    }
}

/**
 * Every run in the project that has a status, newest first.
 * @param root - project root
 * @returns statuses
 */
export async function listRuns(root: string): Promise<Status[]> {
    const runs = runsRoot(root)

    if (!existsSync(runs)) {
        return []
    }

    const entries = await readdir(runs, { withFileTypes: true })
    const statuses = await Promise.all(
        entries
            .filter(entry => entry.isDirectory())
            .map(entry => readStatus(join(runs, entry.name))),
    )

    return statuses
        .filter((status): status is Status => status !== null)
        .toSorted((a, b) => b.startedAt.localeCompare(a.startedAt))
}

/**
 * Resolve one reference against the project's runs.
 * @param runs - every run, newest first
 * @param ref - id or id prefix
 * @param root - project root, for the error message
 * @returns the run's status
 */
function pick(runs: Status[], ref: string, root: string): Status {
    const exact = runs.find(run => run.id === ref)

    if (exact) {
        return exact
    }

    const matches = runs.filter(run => run.id.startsWith(ref))

    if (matches.length === 1 && matches[0]) {
        return matches[0]
    }

    if (matches.length > 1) {
        throw new Error(
            `${ref} matches ${matches.length} runs: ${matches.map(run => run.id).join(', ')} (give more of the id)`,
        )
    }

    throw new Error(
        runs.length > 0
            ? `no run ${ref} in ${runsRoot(root)} (${commandName()} list shows them)`
            : `no runs yet in ${runsRoot(root)}`,
    )
}

/**
 * Find runs by their ids or unambiguous starts of them, reading the runs folder once.
 * @param root - project root
 * @param refs - ids or id prefixes
 * @returns the runs' statuses, in the order asked
 */
export async function findRuns(root: string, refs: string[]): Promise<Status[]> {
    const runs = await listRuns(root)

    return refs.map(ref => pick(runs, ref, root))
}

/**
 * Read the text a settled run kept: its answer, or its partial answer.
 * @param status - settled status
 * @returns the text, or null when it kept none
 */
export async function readKept(status: Status): Promise<string | null> {
    const path = status.answer ?? status.partial

    return path ? readFile(path, 'utf8').catch(() => null) : null
}
