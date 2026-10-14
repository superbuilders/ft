import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, it, vi } from 'vitest'

import { runningPids } from './processes'

it('filters one process snapshot to owned ids, preserving evidence order', async () => {
    expect(await runningPids([0, process.pid])).toEqual([process.pid])
    expect(await runningPids([])).toEqual([])
})

it('queries ps once for all owned ids and excludes zombie and missing processes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ft-lab-ps-'))
    const args = join(directory, 'args')

    await writeFile(
        join(directory, 'ps'),
        `#!/bin/sh
printf '%s\\n' "$*" >> '${args}'
printf '  101 S+\\n  102 Z\\n  103 ZN\\n  104 R\\n  105 S\\n'
`,
        { mode: 0o755 },
    )
    vi.stubEnv('PATH', directory)

    try {
        expect(await runningPids([104, 103, 102, 101, 106])).toEqual([104, 101])
        expect(await readFile(args, 'utf8')).toBe('-eo pid=,stat=\n')
    } finally {
        vi.unstubAllEnvs()
        await rm(directory, { recursive: true, force: true })
    }
})
