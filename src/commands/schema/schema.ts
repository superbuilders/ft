import { ConfigSchema } from '../../project/config/schema'
import { SCHEMA_DIALECT } from './constants'

/**
 * Print the JSON Schema for this runner's `.ft.json`, generated from the validator ft itself uses.
 * @returns completion of the schema write
 */
export async function schema(): Promise<void> {
    process.stdout.write(
        `${JSON.stringify({ $schema: SCHEMA_DIALECT, title: '.ft.json', ...ConfigSchema }, null, 4)}\n`,
    )
}
