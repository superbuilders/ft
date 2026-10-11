import { $ } from 'bun'

/**
 * Capture descendant process groups before asking Pi to dispose detached shell tools.
 * @param pid - Pi process group leader
 * @returns groups owned by Pi or its current descendants
 */
export async function descendantGroups(pid: number): Promise<number[]> {
    const result = await $`ps -eo pid=,ppid=,pgid= < /dev/null`.quiet().nothrow()
    const rows = result.stdout
        .toString('utf8')
        .trim()
        .split('\n')
        .map(line => line.trim().split(/\s+/).map(Number))
    const descendants = new Set([pid])
    let added = true

    while (added) {
        added = false

        for (const [child, parent] of rows) {
            if (child && parent && descendants.has(parent) && !descendants.has(child)) {
                descendants.add(child)
                added = true
            }
        }
    }

    const groups = new Set([pid])

    for (const [child, , group] of rows) {
        if (child && group && descendants.has(child)) {
            groups.add(group)
        }
    }

    return [...groups]
}

/**
 * Send a signal to each owned group, tolerating concurrent process exit.
 * @param groups - captured Pi and detached-tool groups
 * @param signal - termination or hard-kill signal
 * @returns nothing
 */
export function signalGroups(groups: number[], signal: NodeJS.Signals): void {
    for (const group of groups) {
        try {
            process.kill(-group, signal)
        } catch {
            /* Exited groups need no cleanup. */
        }
    }
}
