import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve as resolvePath } from 'node:path'

import { MODEL_CATALOG } from '../../models/constants'
import { FROZEN_SETTINGS } from './constants'

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
 * Prepare every shared Pi state file before spawning.
 * @param dir - per-run directory
 * @param baseUrl - configured gateway URL
 * @param context - bounded project instructions
 * @returns private agent and temp paths
 */
export async function prepareAgent(
    dir: string,
    baseUrl: string,
    context: string,
): Promise<{ agent: string; tmp: string; contextPath: string }> {
    const agent = join(dir, 'agent')
    const tmp = join(dir, 'tmp')

    await mkdir(agent, { mode: 0o700 })
    await mkdir(tmp, { mode: 0o700 })

    const auth = {
        truefoundry: { type: 'api_key', key: `!${[...selfCommand(), 'key'].map(quote).join(' ')}` },
    }
    const models = {
        providers: {
            truefoundry: {
                baseUrl: `${baseUrl}/v1`,
                api: 'openai-completions',
                compat: { supportsDeveloperRole: false },
                models: MODEL_CATALOG,
            },
        },
    }

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
