import { Command, CommanderError } from 'commander'

import { register } from './commands/register'
import { resultFor } from './lib/local'
import { PrerequisiteError } from './lib/processes'

const program = new Command()
    .name('lab')
    .description('Run ft smoke tests in throwaway folders the lab manages (not a security sandbox)')
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

        const usage = error instanceof CommanderError || error instanceof PrerequisiteError

        result.outcome = usage ? 'prerequisite_error' : 'lab_error'
        result.error = error instanceof Error ? error.message : String(error)
        process.stderr.write(`${result.error}\n`)
        process.stdout.write(`${JSON.stringify(result)}\n`)
        process.exitCode = usage ? 2 : 3
    }
}
