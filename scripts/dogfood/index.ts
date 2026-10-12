import { Command } from 'commander'

import { runDogfood } from './commands/dogfood'

new Command()
    .name('dogfood')
    .description(
        "Build ft from the last commit and install it as ft on PATH, for this repository's agents",
    )
    .action(runDogfood)
    .parseAsync()
    .catch((error: unknown) => {
        console.error(error instanceof Error ? error.message : String(error))
        process.exitCode = 1
    })
