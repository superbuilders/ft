import { Command } from 'commander'

import { runDogfood } from './commands/dogfood'

new Command()
    .name('dogfood')
    .description('Build ft from the last commit and install it as ft-dev, beside the installed ft')
    .option('--remove', 'remove ft-dev')
    .action(runDogfood)
    .parseAsync()
    .catch((error: unknown) => {
        console.error(error instanceof Error ? error.message : String(error))
        process.exitCode = 1
    })
