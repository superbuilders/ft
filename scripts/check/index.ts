import { Command } from 'commander'

import { runCheck } from './commands/check'

new Command()
    .name('check')
    .description('Run the quality gates inside hooks and CI')
    .option('--pre-push', 'Add type-aware lint and unused-code detection')
    .action(runCheck)
    .parseAsync()
    .catch((error: unknown) => {
        console.error(error instanceof Error ? error.message : String(error))
        process.exitCode = 1
    })
