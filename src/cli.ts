import { Command } from 'commander'

import { doctor } from './commands/doctor/doctor'
import { key } from './commands/key/key'
import { pin } from './commands/pin/pin'
import { run } from './commands/run/run'
import { schema } from './commands/schema/schema'
import { RUNNER_VERSION } from './version'

import type { RunOptions } from './commands/run/types'

const program = new Command().name('ft').version(RUNNER_VERSION)

program.command('key <provider>').description("Print a configured provider's key").action(key)
program
    .command('run')
    .description('Run one brief on one pinned model')
    .requiredOption('--brief <path>', 'brief file')
    .requiredOption('--out <path>', 'answer destination')
    .option('--lane <name>', 'configured lane (default: code)')
    .option('--model <ref>', 'provider/model, instead of a lane')
    .option('--cwd <dir>', 'run directory')
    .option('--profile <profile>', 'read or write tools')
    .option('--thinking <level>', 'thinking override')
    .option('--deadline <seconds>', 'optional wall-clock deadline')
    .action(async (options: RunOptions) => {
        process.exitCode = await run(options)
    })
program.command('pin <version>').description('Pin a runner release in .ft/lock.json').action(pin)
program.command('schema').description('Print the JSON Schema for .ft.json').action(schema)
program
    .command('doctor')
    .description('Show config and runtime health')
    .action(() => doctor(RUNNER_VERSION))

try {
    await program.parseAsync()
} catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'ft failed'}\n`)
    process.exitCode = program.args[0] === 'key' ? 1 : 2
}
