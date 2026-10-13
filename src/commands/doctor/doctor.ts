import { existsSync } from 'node:fs'

import { PI_VERSION, TOOL_RELEASES } from '../../pi/runtime/constants'
import { runtimePaths } from '../../pi/runtime/runtime'
import { isPersonal, loadConfig, resolveBaseUrl } from '../../project/config/config'
import { getKey } from '../../project/key/key'
import { cacheRoot, platformTarget } from '../../system/host/host'

/**
 * Print installation and credential health without exposing any credential. Tools that are not
 * installed yet are not problems: the next run installs them.
 * @param runnerVersion - this runner's version
 * @returns exit code: 0 when ready, 2 when a lane, endpoint or key check failed
 */
export async function doctor(runnerVersion: string): Promise<number> {
    platformTarget()

    const config = await loadConfig(process.cwd())
    const paths = runtimePaths(cacheRoot())
    const lines = [
        `Config: ${config.path}${isPersonal(config.path) ? ' (personal; this directory has no .ft.json)' : ''}`,
        `Project: ${config.workspace}`,
        `Runner: ${runnerVersion}`,
        `Pi: ${PI_VERSION} (${existsSync(paths.pi) ? 'installed' : 'not installed'})`,
    ]

    for (const name of ['rg', 'fd'] as const) {
        lines.push(
            `${name}: ${TOOL_RELEASES[name].version} (${existsSync(paths.tools[name]) ? 'installed' : 'not installed'})`,
        )
    }

    let problems = 0

    if (Object.keys(config.config.lanes).length === 0) {
        problems++
        lines.push(`Lanes: none yet; add one named code to ${config.path}`)
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
            problems++
            lines.push(`Provider ${id}: ${(error as Error).message}`)
        }

        try {
            await getKey(provider.key, config.root)
            lines.push(`Provider ${id}: key loaded`)
        } catch (error) {
            problems++
            lines.push(`Provider ${id}: key failed (${(error as Error).message})`)
        }
    }

    lines.push(
        problems === 0
            ? 'Ready'
            : `Not ready: ${problems} ${problems === 1 ? 'problem' : 'problems'} above`,
    )
    process.stdout.write(`${lines.join('\n')}\n`)

    return problems === 0 ? 0 : 2
}
