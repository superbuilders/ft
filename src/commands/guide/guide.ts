import { PI_VERSION } from '../../pi/runtime/constants'
import { loadConfig } from '../../project/config/config'
import { GUIDE_BODY, LANE_FALLBACK_DESCRIPTION } from './constants'

/**
 * Describe this project's lanes, or why they could not be read.
 * @returns markdown lines
 */
async function lanes(): Promise<string[]> {
    try {
        const { config, path } = await loadConfig(process.cwd())
        const entries = Object.entries(config.lanes)

        if (entries.length === 0) {
            return [`${path} defines no lanes yet; add one named code.`]
        }

        return entries.map(
            ([name, lane]) =>
                `- ${name}${name === 'code' ? ' (default)' : ''}: ${lane.model}${lane.thinking ? `, thinking ${lane.thinking}` : ''}. ${lane.description ?? LANE_FALLBACK_DESCRIPTION}`,
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
 * Print the agent-facing manual for exactly this runner: what it does, this project's lanes, and
 * how to run, wait for and read runs. A skill points here instead of restating flags that drift.
 * @param runnerVersion - this runner's version
 * @returns completion
 */
export async function guide(runnerVersion: string): Promise<void> {
    const text = [
        `# ft ${runnerVersion}: hand a bounded task to another model`,
        '',
        `ft runs one brief on one model in a separate, pinned Pi coding-agent session (Pi ${PI_VERSION}). The delegate does not see your conversation, but it works in your working tree. ft records each run under .ft/runs/<id>/. Use it for a second opinion, a parallel review, web research, or a scoped change you will review yourself.`,
        '',
        'Commands here are written `ft ...`. If this repository runs ft through a package script (such as `bun ft`, or `npm run ft --` with npm) or `.ft/ft`, write every command that way.',
        '',
        '## Available lanes',
        '',
        'A lane is a named model choice in the active .ft.json, with an optional thinking level. Runs use `code` unless you pass `--lane <name>`, or `--model provider/model` to pick a model directly.',
        '',
        ...(await lanes()),
        '',
        GUIDE_BODY,
    ]

    process.stdout.write(text.join('\n'))
}
