import { DEFAULT_ROLE } from '../../models/constants'
import { RUN_PROFILES } from '../../pi/run/constants'
import { PI_VERSION } from '../../pi/runtime/constants'
import { loadConfig } from '../../project/config/config'
import { GUIDE_BODY, ROLE_FALLBACK_DESCRIPTION } from './constants'

/**
 * Describe this project's roles, or why they could not be read.
 * @returns markdown lines
 */
async function roles(): Promise<string[]> {
    try {
        const { config, path } = await loadConfig(process.cwd())
        const entries = Object.entries(config.roles)

        if (entries.length === 0) {
            return [`${path} defines no roles yet; add one named code.`]
        }

        return entries.map(
            ([name, role]) =>
                `- ${name}${name === DEFAULT_ROLE ? ' (default)' : ''}: ${role.model}${role.thinking ? `, thinking ${role.thinking}` : ''}. ${role.description ?? ROLE_FALLBACK_DESCRIPTION}`,
        )
    } catch (error) {
        return [
            'ft could not load its config here:',
            '',
            error instanceof Error ? error.message : 'unknown error',
        ]
    }
}

/**
 * Write tool names as a reader lists them.
 * @param tools - tool names
 * @returns for example "read, grep and bash"
 */
function listed(tools: readonly string[]): string {
    return tools.length > 1
        ? `${tools.slice(0, -1).join(', ')} and ${tools.at(-1)}`
        : tools.join('')
}

/**
 * Print the agent-facing manual for exactly this runner: what it does, this project's roles, and
 * how to run, wait for and read runs. A skill points here instead of restating flags that drift.
 * @param runnerVersion - this runner's version
 * @returns completion
 */
export async function guide(runnerVersion: string): Promise<void> {
    const read = RUN_PROFILES.read?.tools ?? []
    const write = RUN_PROFILES.write?.tools ?? []
    const text = [
        `# ft ${runnerVersion}: hand a bounded task to another model`,
        '',
        `ft runs one brief on one model in a separate, pinned Pi coding-agent session (Pi ${PI_VERSION}). The delegate does not see your conversation, but it works in your working tree. ft records each run under .ft/runs/<id>/. Use it for a second opinion, a parallel review, web research, or a scoped change you will review yourself.`,
        '',
        'Commands here are written `ft ...`. If this repository runs ft through a package script (such as `bun ft`, or `npm run ft --` with npm) or `.ft/ft`, write every command that way.',
        '',
        '## Available roles',
        '',
        'A role is a named model choice in the active .ft.json, with an optional thinking level. Runs use `code` unless you pass `--role <name>`, or `--model provider/model` to pick a model directly.',
        '',
        ...(await roles()),
        '',
        GUIDE_BODY.replace('{read tools}', listed(read)).replace(
            '{write tools}',
            listed(write.filter(tool => !read.includes(tool))),
        ),
    ]

    process.stdout.write(text.join('\n'))
}
