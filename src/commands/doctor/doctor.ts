import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { PI_VERSION, TOOL_RELEASES } from '../../pi/runtime/constants'
import { runtimePaths } from '../../pi/runtime/runtime'
import { isPersonal, loadConfig, resolveBaseUrl } from '../../project/config/config'
import { CONFIG_FILE } from '../../project/config/constants'
import { getKey } from '../../project/key/key'
import { cacheRoot, configRoot, platformTarget, tildePath } from '../../system/host/host'
import { aligned } from '../../system/terminal/columns'
import { styleFor } from '../../system/terminal/style'

import type { Style } from '../../system/terminal/types'

/**
 * Say whether a tool is installed: a mark on a terminal, a word everywhere else.
 * @param installed - whether it is installed
 * @param style - output styles
 * @returns the marker
 */
function installedMark(installed: boolean, style: Style): string {
    if (!style.on) {
        return installed ? '(installed)' : '(not installed yet)'
    }

    return installed ? style.green('✔') : style.dim('not installed yet')
}

/**
 * Pad a top-level label to the column its values start at.
 * @param text - the label
 * @param style - output styles
 * @returns the styled, padded label
 */
function heading(text: string, style: Style): string {
    return style.bold(text.padEnd(9))
}

/**
 * Print installation and credential health without exposing any credential. Tools that are not
 * installed yet are not problems: the next run installs them. The last line is always `Ready` or
 * `Not ready: ...`.
 * @param runnerVersion - this runner's version
 * @param options - command options
 * @param options.user - check the personal config rather than the one that applies here
 * @returns exit code: 0 when ready, 2 when a role, endpoint or key check failed
 */
export async function doctor(runnerVersion: string, options: { user?: boolean }): Promise<number> {
    platformTarget()

    const style = styleFor(process.stdout)
    const user = options.user === true
    const config = await loadConfig(process.cwd(), user)
    const paths = runtimePaths(cacheRoot())
    const personal = join(configRoot(), CONFIG_FILE)
    const lines = [`${heading('Config', style)} ${tildePath(config.path)}`]
    const indent = ' '.repeat(10)

    if (user) {
        lines[0] += style.dim(' (personal)')
    } else if (isPersonal(config.path)) {
        lines[0] += style.dim(' (personal)')
        lines.push(
            `${indent}${style.dim(`(this directory has no ${CONFIG_FILE}, so your personal config applies)`)}`,
        )
    } else if (existsSync(personal)) {
        /* The two never merge, so say which one is in play; doctor --user checks the other. */
        lines.push(
            `${indent}${style.dim(`(your personal config, ${tildePath(personal)}, is not used here)`)}`,
        )
    }

    if (!user) {
        lines.push(`${heading('Project', style)} ${tildePath(config.workspace)}`)
    }

    const tools = [
        `Pi ${PI_VERSION} ${installedMark(existsSync(paths.pi), style)}`,
        ...(['rg', 'fd'] as const).map(
            name =>
                `${name} ${TOOL_RELEASES[name].version} ${installedMark(existsSync(paths.tools[name]), style)}`,
        ),
    ]

    lines.push(
        `${heading('Runner', style)} ${runnerVersion}   ${tools.join('   ')}`,
        '',
        style.bold('Roles'),
    )

    let problems = 0
    const roles = Object.entries(config.config.roles)

    if (roles.length === 0) {
        problems++
        lines.push(style.red(`  none yet; add one named code to ${tildePath(config.path)}`))
    } else {
        lines.push(
            ...aligned(
                roles.map(([name, role]) => [
                    name,
                    `${role.model}${role.thinking ? style.dim(`, thinking ${role.thinking}`) : ''}`,
                ]),
                '  ',
            ),
        )
    }

    const providers: [string, string][] = []

    for (const [id, provider] of Object.entries(config.config.providers)) {
        let where: string

        try {
            where = style.dim(resolveBaseUrl(id, provider) ?? "Pi's built-in endpoint")
        } catch (error) {
            problems++
            where = style.red((error as Error).message)
        }

        try {
            await getKey(provider.key, config.root)
            providers.push([id, `${where}   ${style.mark(true)}key loaded`])
        } catch (error) {
            problems++
            providers.push([
                id,
                `${where}   ${style.mark(false)}${style.red(`key failed (${(error as Error).message})`)}`,
            ])
        }
    }

    if (providers.length > 0) {
        lines.push('', style.bold('Providers'), ...aligned(providers, '  '))
    }

    lines.push(
        '',
        problems === 0
            ? `${style.mark(true)}${style.green('Ready')}`
            : `${style.mark(false)}${style.red(`Not ready: ${problems} ${problems === 1 ? 'problem' : 'problems'} above`)}`,
    )
    process.stdout.write(`${lines.join('\n')}\n`)

    return problems === 0 ? 0 : 2
}
