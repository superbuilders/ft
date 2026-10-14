import { descendantGroups, signalGroups } from '../../system/process/process-groups'
import { BRIEF_COMMAND_ID } from '../events/constants'
import { eventParser } from '../events/judge'
import { KILL_GRACE_MS } from './constants'
import { piEnvironment } from './environment'

import type { Selection } from '../../models/types'
import type { JudgeState } from '../events/types'
import type { PiControl } from './types'

/**
 * Run the pinned Pi in a process group while draining both pipes continuously. Pi runs in RPC
 * mode: the brief goes in as a prompt command and stdin stays open, so a control can steer the
 * run, until Pi settles and stdin closes, which ends Pi.
 * @param input - explicit runtime, prompt, state, output sinks and an optional control
 * @returns Pi's exit status and signal
 */
export async function runPi(input: {
    pi: string
    cwd: string
    brief: string
    selected: Selection
    tools: readonly string[]
    env: NodeJS.ProcessEnv
    toolDirs: string[]
    agent: string
    tmp: string
    contextPath: string
    state: JudgeState
    progress?: () => void
    control?: PiControl
    signal: AbortSignal
    events: (chunk: Buffer) => void
    stderr: (chunk: Buffer) => void
}): Promise<{ code: number | null; signal: string | null }> {
    input.signal.throwIfAborted()

    const flags = [
        '--mode',
        'rpc',
        '--no-session',
        '--no-approve',
        '--no-extensions',
        '--no-skills',
        '--no-prompt-templates',
        '--no-themes',
        '--no-context-files',
        '--provider',
        input.selected.provider,
        '--model',
        /* Pi strips exactly one leading "<provider>/", so an id that starts with a provider name stays whole. */
        `${input.selected.provider}/${input.selected.model}`,
        '--append-system-prompt',
        input.contextPath,
    ]

    if (input.tools.length > 0) {
        flags.push('--tools', input.tools.join(','))
    } else {
        flags.push('--no-tools')
    }

    if (input.selected.thinking) {
        flags.push('--thinking', input.selected.thinking)
    }

    const child = Bun.spawn([input.pi, ...flags], {
        cwd: input.cwd,
        detached: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: piEnvironment(input.env, input.agent, input.tmp, input.toolDirs),
    })
    let open = true

    /**
     * Send one command line to Pi while its stdin is open.
     * @param line - an LF-terminated JSON command
     * @returns nothing
     */
    function send(line: string): void {
        if (!open) {
            return
        }

        try {
            void child.stdin.write(line)
            void Promise.resolve(child.stdin.flush()).catch(() => {})
        } catch {
            /* Pi may close stdin early; its exit and protocol still determine the verdict. */
        }
    }

    /**
     * Close Pi's stdin, which asks Pi to shut down once it is idle.
     * @returns nothing
     */
    function close(): void {
        if (open) {
            open = false
            void Promise.resolve()
                .then(() => child.stdin.end())
                .catch(() => {})
        }
    }

    const parser = eventParser(input.state, input.progress, event => {
        input.control?.observe(event)

        /* Settled means Pi will not continue on its own. */
        if (event.type === 'agent_settled') {
            close()
        }
    })

    /**
     * Terminate Pi's process group, then kill whatever is left once the grace period ends.
     * @returns completion after the hard kill
     */
    async function terminate(): Promise<void> {
        const groups = await descendantGroups(child.pid)

        signalGroups(groups, 'SIGTERM')
        await Bun.sleep(KILL_GRACE_MS)
        signalGroups(groups, 'SIGKILL')
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

            /* A run that failed before Pi took the brief has nothing left to wait for. */
            if (input.state.protocolError && !input.state.accepted) {
                close()
            }
        }
    })()
    const stderr = (async () => {
        for await (const bytes of child.stderr) {
            input.stderr(Buffer.from(bytes))
        }
    })()

    /* Several steers delivered at one boundary reach the model together, in the order sent. */
    send(`${JSON.stringify({ type: 'set_steering_mode', mode: 'all' })}\n`)
    send(`${JSON.stringify({ id: BRIEF_COMMAND_ID, type: 'prompt', message: input.brief })}\n`)
    input.control?.attach(send)

    try {
        await Promise.all([child.exited, stdout, stderr])
        close()
        parser.end()

        return { code: child.exitCode, signal: child.signalCode }
    } finally {
        input.signal.removeEventListener('abort', abort)
        /* Waits for the hard kill even if Pi exits first, so detached tool children are not left behind. */
        await termination
    }
}
