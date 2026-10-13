import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { DEFAULT_ROLE, EXAMPLE_CONFIG } from '../../models/constants'
import { PI_VERSION, TOOL_RELEASES } from '../../pi/runtime/constants'
import { runtimePaths } from '../../pi/runtime/runtime'
import { isPersonal, loadConfig, resolveBaseUrl } from '../../project/config/config'
import { CONFIG_FILE } from '../../project/config/constants'
import { getKey } from '../../project/key/key'
import { probeKey } from '../../project/key/probe'
import { cacheRoot, configRoot, platformTarget, tildePath } from '../../system/host/host'
import { aligned } from '../../system/terminal/columns'
import { styleFor } from '../../system/terminal/style'

import type { Provider } from '../../models/types'
import type { ProbeResult } from '../../project/key/types'
import type { Style } from '../../system/terminal/types'
import type { ProviderCheck } from './types'

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
 * Say what the key check found, naming the config field to fix when the provider refused the key.
 * @param probe - the check's result
 * @param id - provider id
 * @param path - the config file
 * @param style - output styles
 * @returns the verdict text
 */
function keyVerdict(probe: ProbeResult, id: string, path: string, style: Style): string {
    if (probe.verdict === 'accepted') {
        return `${style.mark(true)}key accepted`
    }

    if (probe.verdict === 'rejected') {
        return `${style.mark(false)}${style.red(`the provider rejected the key (HTTP ${probe.status}; check providers.${id}.key in ${tildePath(path)})`)}`
    }

    return `${style.mark(true)}key loaded ${style.dim(`(not checked: ${probe.reason})`)}`
}

/**
 * Check one provider: its endpoint resolves, its key loads, and the provider accepts the key.
 * @param id - provider id
 * @param provider - configured provider
 * @param root - project root, the key command's working directory
 * @param path - the config file
 * @param style - output styles
 * @returns the report row, and whether it is a problem
 */
async function checkProvider(
    id: string,
    provider: Provider,
    root: string,
    path: string,
    style: Style,
): Promise<ProviderCheck> {
    let baseUrl: string | undefined

    try {
        baseUrl = resolveBaseUrl(id, provider)
    } catch (error) {
        return { row: [id, style.red((error as Error).message)], problem: true }
    }

    const where = style.dim(baseUrl ?? "Pi's built-in endpoint")
    let key: string

    try {
        key = await getKey(provider.key, root)
    } catch (error) {
        return {
            row: [
                id,
                `${where}   ${style.mark(false)}${style.red(`key failed (${(error as Error).message})`)}`,
            ],
            problem: true,
        }
    }

    const probe = await probeKey(id, provider, baseUrl, key)

    return {
        row: [id, `${where}   ${keyVerdict(probe, id, path, style)}`],
        problem: probe.verdict === 'rejected',
    }
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
        lines.push(
            style.red(
                `  none yet; add one named ${DEFAULT_ROLE} to ${tildePath(config.path)}, as in this minimal config:`,
            ),
            '',
            ...EXAMPLE_CONFIG.split('\n').map(line => style.dim(`    ${line}`)),
            '',
        )
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

    const checks = await Promise.all(
        Object.entries(config.config.providers).map(([id, provider]) =>
            checkProvider(id, provider, config.root, config.path, style),
        ),
    )
    const providers = checks.map(check => check.row)

    problems += checks.filter(check => check.problem).length

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
