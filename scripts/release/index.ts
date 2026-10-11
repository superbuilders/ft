import { Command } from 'commander'

import { runRelease } from './commands/release'

new Command()
    .name('release')
    .description('Bump the version, tag it and push; CI builds and publishes the release')
    .argument(
        '<version>',
        'patch, minor, major, or an exact x.y.z (the current version tags it as-is)',
    )
    .action(runRelease)
    .parseAsync()
    .catch((error: unknown) => {
        console.error(error instanceof Error ? error.message : String(error))
        process.exitCode = 1
    })
