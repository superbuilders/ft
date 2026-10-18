import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { hostname, tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { briefTitle, createRun, findRuns, pruneRuns, runName, stateOf, writeStatus } from './store'
import settled from './tests/stubs/status.json'

import type { Status } from './types'

/**
 * A settled, successful run's status, with any fields replaced.
 * @param overrides - fields to change
 * @returns a complete status
 */
function statusWith(overrides: Partial<Status> = {}): Status {
    return { ...(settled as Status), ...overrides }
}

let root: string

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ft-runs-'))
})

afterEach(async () => {
    await rm(root, { recursive: true, force: true })
})

it.each([
    ['Code Review!', 'tmp/brief.md', 'code-review'],
    [undefined, 'tmp/refund-review.md', 'refund-review'],
    [undefined, '-', 'run'],
    ['???', 'x.md', 'run'],
])('names a run from --name %s and brief %s', (name, brief, expected) => {
    expect(runName(name, brief)).toBe(expected)
})

it('titles a run with the brief’s first line that says something', () => {
    expect(briefTitle('\n<task>\n# Review the refund change\n</task>')).toBe(
        'Review the refund change',
    )
})

it('keeps runs out of git and gives each its own folder', async () => {
    const first = await createRun(root, 'review')
    const second = await createRun(root, 'review')

    expect(first.id).toMatch(/^review-[0-9a-f]{4}$/)
    expect(second.id).not.toBe(first.id)
    expect(await readFile(join(root, '.gitignore'), 'utf8')).toBe('*\n')
})

describe('finding a run', () => {
    beforeEach(async () => {
        for (const id of ['review-aaaa', 'review-aabb', 'research-cccc']) {
            const { dir } = await createRun(root, id)

            await writeStatus(statusWith({ id, dir }))
        }
    })

    it('accepts an unambiguous prefix', async () => {
        const found = await findRuns(root, ['res', 'review-aabb'])

        expect(found.map(run => run.id)).toEqual(['research-cccc', 'review-aabb'])
    })

    it('names the candidates when a prefix is ambiguous', async () => {
        await expect(findRuns(root, ['review-a'])).rejects.toThrow(/matches 2 runs/)
    })

    it('says how to list runs when none matches', async () => {
        await expect(findRuns(root, ['nope'])).rejects.toThrow(/ft list shows them/)
    })
})

describe('pruning old runs', () => {
    const old = new Date(Date.now() - 20 * 86_400_000).toISOString()

    beforeEach(async () => {
        const runs = {
            'old-aaaa': statusWith({ updatedAt: old }),
            'new-bbbb': statusWith({ updatedAt: new Date().toISOString() }),
            'busy-cccc': statusWith({
                updatedAt: old,
                outcome: 'running',
                pid: process.pid,
                host: hostname(),
            }),
        }

        for (const [id, status] of Object.entries(runs)) {
            const { dir } = await createRun(root, id)

            /* writeStatus would stamp updatedAt with now. */
            await writeFile(join(dir, 'status.json'), JSON.stringify({ ...status, id, dir }))
        }
    })

    it('deletes finished runs past the limit and keeps new and running ones', async () => {
        await pruneRuns(root, 14)

        const left = await readdir(root)

        expect(left.map(name => name.split('-')[0]).toSorted()).toEqual([
            '.gitignore',
            'busy',
            'new',
        ])
    })

    it('keeps every run at 0', async () => {
        await pruneRuns(root, 0)

        expect(await readdir(root)).toHaveLength(4)
    })
})

it('calls a running run lost once its process is gone', () => {
    const child = Bun.spawnSync(['true'])

    expect(stateOf(statusWith({ outcome: 'running', pid: child.pid, host: hostname() }))).toBe(
        'lost',
    )
    expect(stateOf(statusWith({ outcome: 'running', pid: process.pid, host: hostname() }))).toBe(
        'running',
    )
})
