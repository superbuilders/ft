import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve as resolvePath } from 'node:path'

import { FROZEN_SETTINGS } from './constants'

import type { Provider } from '../../models/types'

/**
 * Quote one shell argument for the command reference in auth.json.
 * @param value - literal argv element
 * @returns POSIX-shell-safe argument
 */
function quote(value: string): string {
    return `'${value.replaceAll("'", String.raw`'\''`)}'`
}

/**
 * Describe this runner in compiled and source execution modes.
 * @returns absolute command argv without credentials
 */
function selfCommand(): string[] {
    return process.argv[1]?.endsWith('.ts')
        ? [process.execPath, resolvePath(process.argv[1])]
        : [process.execPath]
}

/**
 * Translate ft's provider config into Pi's models.json entry, dropping the fields only ft reads.
 * @param provider - configured provider
 * @param baseUrl - where Pi should send requests, when ft's local gateway stands in for the provider
 * @returns Pi's provider entry, empty for a built-in provider with no overrides
 */
function piProvider(provider: Provider, baseUrl?: string): Record<string, unknown> {
    const { key, models, ...fields } = provider

    return {
        ...fields,
        ...(baseUrl ? { baseUrl } : {}),
        ...(models ? { models: models.map(({ adapter, ...model }) => model) } : {}),
    }
}

/**
 * Prepare every shared Pi state file before spawning, configuring only the run's provider.
 * @param dir - per-run directory
 * @param run - the run's provider
 * @param run.id - configured provider id, also Pi's provider id
 * @param run.provider - the provider's config
 * @param run.baseUrl - ft's local gateway, when the run's model has an adapter
 * @param context - bounded project instructions
 * @returns private agent and temp paths
 */
export async function prepareAgent(
    dir: string,
    run: { id: string; provider: Provider; baseUrl?: string },
    context: string,
): Promise<{ agent: string; tmp: string; contextPath: string }> {
    const agent = join(dir, 'agent')
    const tmp = join(dir, 'tmp')

    await mkdir(agent, { mode: 0o700 })
    await mkdir(tmp, { mode: 0o700 })

    const auth = {
        [run.id]: {
            type: 'api_key',
            key: `!${[...selfCommand(), 'key', run.id].map(quote).join(' ')}`,
        },
    }
    const entry = piProvider(run.provider, run.baseUrl)
    const models = { providers: Object.keys(entry).length > 0 ? { [run.id]: entry } : {} }

    for (const [name, contents] of Object.entries({
        'settings.json': FROZEN_SETTINGS,
        'models.json': models,
        'auth.json': auth,
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
