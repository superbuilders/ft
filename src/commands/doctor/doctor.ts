import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { PI_VERSION, TOOL_RELEASES } from '../../pi/runtime/constants'
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
    const root = cacheRoot()
    const lines = [
        `Config: ${config.path}`,
        `Project root: ${dirname(config.path)}`,
        `Runner: ${runnerVersion}`,
        `Pi: ${PI_VERSION} (${existsSync(join(root, 'pi', PI_VERSION)) ? 'installed' : 'not installed'})`,
    ]

    for (const [name, release] of Object.entries(TOOL_RELEASES)) {
        lines.push(
            `${name}: ${release.version} (${existsSync(join(root, 'tools', `${name}-${release.version}`)) ? 'installed' : 'not installed'})`,
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
