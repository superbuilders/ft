import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve as resolvePath } from 'node:path'

import { FROZEN_SETTINGS, KILL_GRACE_MS, MODEL_CATALOG } from './constants'
import { piEnvironment } from './environment'
import { eventParser } from './judge'
import { descendantGroups, signalGroups } from './process'

import type { JudgeState, Lane } from './types'

/**
 * Quote one shell argument for the command reference in auth.json.
 * @param value - literal argv element
 * @returns POSIX-shell-safe argument
 */
function quote(value: string): string {
    return `'${value.replaceAll("'", String.raw`'\''`)}'`
}

/**
 * Describe this runner in compiled and source execution modes.
 * @returns absolute command argv without credentials
 */
function selfCommand(): string[] {
    return process.argv[1]?.endsWith('.ts')
        ? [process.execPath, resolvePath(process.argv[1])]
        : [process.execPath]
}

/**
 * Prepare every shared Pi state file before spawning.
 * @param dir - per-run directory
 * @param baseUrl - configured gateway URL
 * @param context - bounded project instructions
 * @returns private agent and temp paths
 */
export async function prepareAgent(
    dir: string,
    baseUrl: string,
    context: string,
): Promise<{ agent: string; tmp: string; contextPath: string }> {
    const agent = join(dir, 'agent')
    const tmp = join(dir, 'tmp')

    await mkdir(agent, { mode: 0o700 })
    await mkdir(tmp, { mode: 0o700 })

    const auth = {
        truefoundry: { type: 'api_key', key: `!${[...selfCommand(), 'key'].map(quote).join(' ')}` },
    }
    const models = {
        providers: {
            truefoundry: {
                baseUrl: `${baseUrl}/v1`,
                api: 'openai-completions',
                compat: { supportsDeveloperRole: false },
                models: MODEL_CATALOG,
            },
        },
    }

    for (const [name, contents] of Object.entries({
        'settings.json': FROZEN_SETTINGS,
        'models.json': models,
        'auth.json': auth,
        'models-store.json': {},
        'trust.json': {},
    })) {
        await writeFile(join(agent, name), `${JSON.stringify(contents, null, 4)}\n`, {
            mode: 0o600,
        })
    }

    const contextPath = join(dir, 'context.md')

    await writeFile(contextPath, context, { mode: 0o600 })

    return { agent, tmp, contextPath }
}

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
