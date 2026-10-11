import { existsSync } from 'node:fs'

import { PI_VERSION, TOOL_RELEASES } from '../../pi/runtime/constants'
import { runtimePaths } from '../../pi/runtime/runtime'
import { loadConfig } from '../../project/config/config'
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
        `Config: ${config.path}`,
        `Project root: ${config.root}`,
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
            await getKey(provider.key, config.root)
            lines.push(`Provider ${id}: key ready`)
        } catch {
            lines.push(`Provider ${id}: key failed (run ft key ${id} to see why)`)
        }
    }

    process.stdout.write(`${lines.join('\n')}\n`)
}
