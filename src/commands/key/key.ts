import { brokerKey } from '../../pi/agent/key-broker'
import { loadConfig } from '../../project/config/config'
import { getKey } from '../../project/key/key'

/**
 * Print the project key: from the run's broker when Pi asks, else from the project's key source.
 * @returns completion of the key write
 */
export async function key(): Promise<void> {
    const socket = process.env.FT_KEY_SOCKET
    const value = socket ? await brokerKey(socket) : await getKey(await loadConfig(process.cwd()))

    process.stdout.write(`${value}\n`)
}
