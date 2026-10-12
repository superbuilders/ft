import { isAbsolute, resolve } from 'node:path'

import { FT_COMMAND } from './patterns'

/**
 * The argv that runs this same ft again, in both compiled and source execution modes.
 * @returns absolute command argv
 */
export function selfCommand(): string[] {
    return process.argv[1]?.endsWith('.ts')
        ? [process.execPath, resolve(process.argv[1])]
        : [process.execPath]
}

/**
 * How the person or agent who started this ft runs it, so printed commands can be pasted back:
 * a package script (`bun ft`, `npm run ft`), a launcher path inside the repository (`.ft/ft`),
 * or plain `ft` from PATH.
 * @param env - the process environment
 * @returns the command prefix
 */
export function invocation(env: NodeJS.ProcessEnv = process.env): string {
    const script = env.npm_lifecycle_event

    if (script) {
        const manager = env.npm_config_user_agent?.split('/')[0] || 'npm'

        return manager === 'npm' ? `npm run ${script}` : `${manager} ${script}`
    }

    const launcher = env.FT_LAUNCHER

    if (launcher && !isAbsolute(launcher) && launcher.includes('/')) {
        return launcher
    }

    return 'ft'
}

/**
 * Rewrite `ft <command>` in text a person or agent reads to the way they run ft.
 * @param text - human-facing output
 * @param prefix - the invocation
 * @returns the text with every ft command spelled the caller's way
 */
export function spelled(text: string, prefix: string): string {
    return prefix === 'ft'
        ? text
        : text.replaceAll(FT_COMMAND, (_match, before: string) => `${before}${prefix} `)
}
