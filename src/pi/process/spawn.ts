import { descendantGroups, signalGroups } from '../../system/process/process-groups'
import { eventParser } from '../events/judge'
import { KILL_GRACE_MS } from './constants'
import { piEnvironment } from './environment'

import type { Lane } from '../../models/types'
import type { JudgeState } from '../events/types'

/**
 * Run the pinned Pi in a process group while draining both pipes continuously.
 * @param input - explicit runtime, prompt, state and output sinks
 * @returns Pi's exit status and signal
 */
export async function runPi(input: {
    pi: string
    cwd: string
    brief: string
    selected: Lane
    profile: string
    env: NodeJS.ProcessEnv
    toolDirs: string[]
    agent: string
    tmp: string
    contextPath: string
    state: JudgeState
    signal: AbortSignal
    events: (chunk: Buffer) => void
    stderr: (chunk: Buffer) => void
}): Promise<{ code: number | null; signal: string | null }> {
    input.signal.throwIfAborted()

    const flags = [
        '-p',
        '--mode',
        'json',
        '--no-session',
        '--no-approve',
        '--no-extensions',
        '--no-skills',
        '--no-prompt-templates',
        '--no-themes',
        '--no-context-files',
        '--provider',
        'truefoundry',
        '--model',
        input.selected.model,
        '--tools',
        input.profile === 'write' ? 'read,grep,find,ls,bash,edit,write' : 'read,grep,find,ls,bash',
        '--append-system-prompt',
        input.contextPath,
    ]

    if (input.selected.thinking) {
        flags.push('--thinking', input.selected.thinking)
    }

    const child = Bun.spawn([input.pi, ...flags], {
        cwd: input.cwd,
        detached: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: piEnvironment(input.env, input.agent, input.tmp, input.toolDirs),
    })
    const parser = eventParser(input.state)
    let killTimer: ReturnType<typeof setTimeout> | undefined

    /**
     * Terminate Pi's process group, escalating after the grace period.
     * @returns nothing
     */
    async function terminate(): Promise<void> {
        const groups = await descendantGroups(child.pid)

        signalGroups(groups, 'SIGTERM')
        killTimer = setTimeout(() => signalGroups(groups, 'SIGKILL'), KILL_GRACE_MS)
    }

    let termination: Promise<void> | undefined

    /**
     * Track asynchronous process-group discovery during cancellation.
     * @returns nothing
     */
    function abort(): void {
        termination = terminate()
    }

    input.signal.addEventListener('abort', abort, { once: true })

    const stdout = (async () => {
        for await (const bytes of child.stdout) {
            const chunk = Buffer.from(bytes)

            input.events(chunk)
            parser.push(chunk)
        }
    })()
    const stderr = (async () => {
        for await (const bytes of child.stderr) {
            input.stderr(Buffer.from(bytes))
        }
    })()
    const stdin = (async () => {
        try {
            await child.stdin.write(input.brief)
            await child.stdin.end()
        } catch {
            /* Pi may close stdin early; its exit and protocol still determine the verdict. */
        }
    })()

    try {
        await Promise.all([child.exited, stdout, stderr, stdin])
        parser.end()

        return { code: child.exitCode, signal: child.signalCode }
    } finally {
        input.signal.removeEventListener('abort', abort)
        await termination

        if (killTimer) {
            /* Keep the hard-kill window even if Pi exits before detached tool children. */
            await new Promise(resolve => setTimeout(resolve, KILL_GRACE_MS))
            clearTimeout(killTimer)
        }
    }
}
