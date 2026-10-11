import { setTimeout as sleep } from 'node:timers/promises'

import { expect, it } from 'vitest'

import { descendantGroups, signalGroups } from './process-groups'

it('captures and kills detached descendant groups even when they ignore SIGTERM', async () => {
    const child = Bun.spawn(
        [
            'bun',
            '-e',
            "const c=Bun.spawn(['sh','-c','trap \"\" TERM; sleep 30'],{detached:true,stdout:'ignore',stderr:'ignore'}); console.log(c.pid); await Bun.sleep(30000)",
        ],
        { detached: true, stdio: ['ignore', 'pipe', 'ignore'] },
    )
    const reader = child.stdout.getReader()
    const { value } = await reader.read()
    const descendant = Number(
        Buffer.from(value ?? [])
            .toString('utf8')
            .trim(),
    )

    reader.releaseLock()

    try {
        await sleep(50)

        const groups = await descendantGroups(child.pid)

        expect(groups).toContain(descendant)
        signalGroups(groups, 'SIGTERM')
        await sleep(50)
        signalGroups(groups, 'SIGKILL')
    } finally {
        signalGroups([child.pid, descendant], 'SIGKILL')
        await child.exited
    }
})
