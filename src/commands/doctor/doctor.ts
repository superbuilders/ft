import { existsSync } from 'node:fs'
import { dirname } from 'node:path'

import { PI_VERSION, TOOL_RELEASES } from '../../pi/runtime/constants'
import { runtimePaths } from '../../pi/runtime/runtime'
import { loadConfig } from '../../project/config/config'
import { getKey } from '../../project/key/key'
import { cacheRoot, platformTarget } from '../../system/host/host'

/**
 * Print installation and credential health without exposing the credential.
 * @param runnerVersion - this runner's version
 * @returns completion of diagnostic output
 */
export async function doctor(runnerVersion: string): Promise<void> {
    platformTarget()

    const config = await loadConfig(process.cwd())
    const paths = runtimePaths(cacheRoot())
    const lines = [
        `Config: ${config.path}`,
        `Project root: ${dirname(config.path)}`,
        `Runner: ${runnerVersion}`,
        `Pi: ${PI_VERSION} (${existsSync(paths.pi) ? 'installed' : 'not installed'})`,
    ]

    for (const name of ['rg', 'fd'] as const) {
        lines.push(
            `${name}: ${TOOL_RELEASES[name].version} (${existsSync(paths.tools[name]) ? 'installed' : 'not installed'})`,
        )
    }

    for (const [name, lane] of Object.entries(config.lanes)) {
        lines.push(
            `Lane ${name}: ${lane.model}${lane.thinking ? ` thinking=${lane.thinking}` : ''}`,
        )
    }

    try {
        await getKey(config)
        lines.push('Key: ready')
    } catch {
        lines.push('Key: failed (see stderr)')
    }

    process.stdout.write(`${lines.join('\n')}\n`)
}
