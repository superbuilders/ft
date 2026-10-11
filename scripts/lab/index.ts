import { Command, CommanderError } from 'commander'

import { register } from './commands/register'
import { resultFor } from './lib/local'

const program = new Command()
    .name('lab')
    .description('Native ft smoke tests in lab-owned scratch state; not a security sandbox')
    .enablePositionalOptions()
    .exitOverride()

register(program)

try {
    await program.parseAsync()
} catch (error) {
    if (error instanceof CommanderError && error.exitCode === 0) {
        process.exitCode = 0
    } else {
        const result = resultFor('usage', 'local')

        result.outcome = error instanceof CommanderError ? 'prerequisite_error' : 'lab_error'
        result.error = error instanceof Error ? error.message : String(error)
        process.stdout.write(`${JSON.stringify(result)}\n`)
        process.exitCode = error instanceof CommanderError ? 2 : 3
    }
}
