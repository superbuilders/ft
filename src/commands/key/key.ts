import { brokerKey } from '../../pi/agent/key-broker'
import { loadConfig } from '../../project/config/config'
import { getKey } from '../../project/key/key'

/**
 * Print a provider's key: from the run's broker when Pi asks, else from the project's key source.
 * @param provider - configured provider id
 * @returns completion of the key write
 */
export async function key(provider: string): Promise<void> {
    const socket = process.env.FT_KEY_SOCKET
    let value: string

    if (socket) {
        value = await brokerKey(socket, provider)
    } else {
        const config = await loadConfig(process.cwd())
        const source = config.config.providers[provider]?.key

        if (!source) {
            throw new Error(`.ft.json does not configure provider ${provider}`)
        }

        value = await getKey(source, config.root)
    }

    process.stdout.write(`${value}\n`)
}
