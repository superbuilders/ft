import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { PI_VERSION, TOOL_RELEASES } from '../../pi/runtime/constants'
import { runtimePaths } from '../../pi/runtime/runtime'
import { isPersonal, loadConfig, resolveBaseUrl } from '../../project/config/config'
import { CONFIG_FILE } from '../../project/config/constants'
import { getKey } from '../../project/key/key'
import { cacheRoot, configRoot, platformTarget, tildePath } from '../../system/host/host'

/**
 * Print installation and credential health without exposing any credential. Tools that are not
 * installed yet are not problems: the next run installs them.
 * @param runnerVersion - this runner's version
 * @param options - command options
 * @param options.user - check the personal config rather than the one that applies here
 * @returns exit code: 0 when ready, 2 when a lane, endpoint or key check failed
 */
export async function doctor(runnerVersion: string, options: { user?: boolean }): Promise<number> {
    platformTarget()

    const user = options.user === true
    const config = await loadConfig(process.cwd(), user)
    const paths = runtimePaths(cacheRoot())
    const personal = join(configRoot(), CONFIG_FILE)
    const lines = [`Config: ${config.path}`]

    if (user) {
        lines[0] += ' (personal)'
    } else if (isPersonal(config.path)) {
        lines[0] += ' (personal; this directory has no .ft.json)'
    } else if (existsSync(personal)) {
        /* The two never merge, so say which one is in play; doctor --user checks the other. */
        lines.push(
            `Personal config: ${tildePath(personal)} (not used here; this repository's .ft.json replaces it)`,
        )
    }

    if (!user) {
        lines.push(`Project: ${config.workspace}`)
    }

    lines.push(
        `Runner: ${runnerVersion}`,
        `Pi: ${PI_VERSION} (${existsSync(paths.pi) ? 'installed' : 'not installed'})`,
    )

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
