import { Command } from 'commander'

import { loadConfig } from './config'
import { brokerKey, getKey } from './key'
import { doctor, pin } from './maintenance'
import { run } from './run'
import { RUNNER_VERSION } from './version'

import type { RunOptions } from './types'

const program = new Command().name('ft').version(RUNNER_VERSION)

program
    .command('key')
    .description('Resolve the project API key')
    .action(async () => {
        const key = process.env.FT_KEY_SOCKET
            ? await brokerKey(process.env.FT_KEY_SOCKET)
            : await getKey(await loadConfig(process.cwd()))

        process.stdout.write(`${key}\n`)
    })
program
    .command('run')
    .description('Run one brief on one pinned model')
    .requiredOption('--brief <path>', 'brief file')
    .requiredOption('--out <path>', 'answer destination')
    .option('--lane <name>', 'configured lane')
    .option('--model <id>', 'exact catalog model')
    .option('--cwd <dir>', 'run directory')
    .option('--profile <profile>', 'read or write tools')
    .option('--thinking <level>', 'thinking override')
    .option('--deadline <seconds>', 'optional wall-clock deadline')
    .action(async (options: RunOptions) => {
        process.exitCode = await run(options)
    })
program.command('pin <version>').description('Pin a runner release in .ft.json').action(pin)
program.command('doctor').description('Show config and runtime health').action(doctor)

try {
    await program.parseAsync()
} catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'ft failed'}\n`)
    process.exitCode = program.args[0] === 'key' ? 1 : 2
}
