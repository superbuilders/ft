import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { selfCommand } from '../../system/process/self'
import { FROZEN_SETTINGS } from './constants'

import type { AgentProvider } from './types'

/**
 * Quote one shell argument for the command reference in auth.json.
 * @param value - literal argv element
 * @returns POSIX-shell-safe argument
 */
function quote(value: string): string {
    return `'${value.replaceAll("'", String.raw`'\''`)}'`
}

/**
 * Translate ft's provider config into Pi's models.json entry. Pi asks ft for the key through the
 * entry's command key, the one credential source Pi accepts for every provider, OAuth-only ones included.
 * @param run - the run's provider
 * @returns Pi's provider entry, without the fields only ft reads
 */
function piProvider(run: AgentProvider): Record<string, unknown> {
    const { key, baseUrl, models, ...fields } = run.provider

    return {
        ...fields,
        ...(run.baseUrl ? { baseUrl: run.baseUrl } : {}),
        apiKey: `!${[...selfCommand(), 'key', run.id].map(quote).join(' ')}`,
        ...(models ? { models: models.map(({ adapter, compactAt, ...model }) => model) } : {}),
    }
}

/**
 * Prepare every shared Pi state file before spawning, configuring only the run's provider.
 * @param dir - per-run directory
 * @param run - the run's provider and the URL Pi should send its requests to
 * @param context - bounded project instructions
 * @param reserveTokens - context Pi keeps free, which sets when it compacts
 * @returns private agent and temp paths
 */
export async function prepareAgent(
    dir: string,
    run: AgentProvider,
    context: string,
    reserveTokens: number,
): Promise<{ agent: string; tmp: string; contextPath: string }> {
    const agent = join(dir, 'agent')
    const tmp = join(dir, 'tmp')

    await mkdir(agent, { mode: 0o700 })
    await mkdir(tmp, { mode: 0o700 })

    for (const [name, contents] of Object.entries({
        'settings.json': { ...FROZEN_SETTINGS, compaction: { reserveTokens } },
        'models.json': { providers: { [run.id]: piProvider(run) } },
        'auth.json': {},
        'models-store.json': {},
        'trust.json': {},
    })) {
        await writeFile(join(agent, name), `${JSON.stringify(contents, null, 4)}\n`, {
            mode: 0o600,
        })
    }

    const contextPath = join(dir, 'context.md')

    await writeFile(contextPath, context, { mode: 0o600 })

    return { agent, tmp, contextPath }
}
