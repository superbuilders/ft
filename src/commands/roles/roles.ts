import { DEFAULT_ROLE } from '../../models/constants'
import { loadConfig } from '../../project/config/config'
import { tildePath } from '../../system/host/host'
import { aligned } from '../../system/terminal/columns'
import { styleFor } from '../../system/terminal/style'

/**
 * List the roles in the config that applies here, with the default marked, so an agent can pick
 * one without rereading the guide.
 * @param options - command options
 * @param options.json - print one JSON object per role instead of the table
 * @returns completion of the listing
 */
export async function roles(options: { json?: boolean }): Promise<void> {
    const { config, path } = await loadConfig(process.cwd())
    const entries = Object.entries(config.roles)

    if (entries.length === 0) {
        throw new Error(`no roles in ${tildePath(path)} yet (add one named ${DEFAULT_ROLE})`)
    }

    if (options.json) {
        for (const [name, role] of entries) {
            process.stdout.write(
                `${JSON.stringify({ name, default: name === DEFAULT_ROLE, ...role })}\n`,
            )
        }

        return
    }

    const style = styleFor(process.stdout)
    const rows = entries.map(([name, role]): [string, string] => {
        const thinking = role.thinking ? style.dim(`, thinking ${role.thinking}`) : ''
        const description = role.description ? `  ${style.dim(role.description)}` : ''

        return [
            name === DEFAULT_ROLE ? `${name} (default)` : name,
            `${role.model}${thinking}${description}`,
        ]
    })

    process.stdout.write(`${aligned(rows, '').join('\n')}\n`)
}
