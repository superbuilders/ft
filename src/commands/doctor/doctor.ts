import { existsSync } from 'node:fs'

import { PI_VERSION, TOOL_RELEASES } from '../../pi/runtime/constants'
import { runtimePaths } from '../../pi/runtime/runtime'
import { isPersonal, loadConfig, resolveBaseUrl } from '../../project/config/config'
import { getKey } from '../../project/key/key'
import { cacheRoot, platformTarget } from '../../system/host/host'

/**
 * Print installation and credential health without exposing any credential.
 * @param runnerVersion - this runner's version
 * @returns completion of diagnostic output
 */
export async function doctor(runnerVersion: string): Promise<void> {
    platformTarget()

    const config = await loadConfig(process.cwd())
    const paths = runtimePaths(cacheRoot())
    const lines = [
        `Config: ${config.path}${isPersonal(config.path) ? ' (personal; this directory has no .ft.json)' : ''}`,
        `Runs: ${config.workspace}`,
        `Runner: ${runnerVersion}`,
        `Pi: ${PI_VERSION} (${existsSync(paths.pi) ? 'installed' : 'not installed'})`,
    ]

    for (const name of ['rg', 'fd'] as const) {
        lines.push(
            `${name}: ${TOOL_RELEASES[name].version} (${existsSync(paths.tools[name]) ? 'installed' : 'not installed'})`,
        )
    }

    for (const [name, lane] of Object.entries(config.config.lanes)) {
        lines.push(
            `Lane ${name}: ${lane.model}${lane.thinking ? ` thinking=${lane.thinking}` : ''}`,
        )
    }

    for (const [id, provider] of Object.entries(config.config.providers)) {
        try {
            const url = resolveBaseUrl(id, provider)

            lines.push(`Provider ${id}: ${url ?? "Pi's built-in endpoint"}`)
        } catch (error) {
            lines.push(`Provider ${id}: ${(error as Error).message}`)
        }

        try {
            await getKey(provider.key, config.root)
            lines.push(`Provider ${id}: key ready`)
        } catch (error) {
            lines.push(`Provider ${id}: key failed (${(error as Error).message})`)
        }
    }

    process.stdout.write(`${lines.join('\n')}\n`)
}
