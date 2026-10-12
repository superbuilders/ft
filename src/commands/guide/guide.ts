import { RUN_PROFILES } from '../../pi/run/constants'
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
            `This directory has no usable .ft.json (${error instanceof Error ? error.message : 'unreadable'}). ft doctor says more.`,
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
        `ft runs one brief on one model through a pinned Pi coding agent (Pi ${PI_VERSION}), isolated from your own session, and records the run under .ft/runs/<id>/. Use it to get a second opinion, a parallel review, web research, or a scoped change you will review yourself.`,
        '',
        '## Lanes in this project',
        '',
        ...(await lanes()),
        '',
        `Profiles: ${Object.entries(RUN_PROFILES)
            .map(([name, { tools }]) => `${name} (${tools.join(', ')})`)
            .join('; ')}.`,
        '',
        GUIDE_BODY,
    ]

    process.stdout.write(text.join('\n'))
}
