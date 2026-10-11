import { Command } from 'commander'

import { e2e } from './lib/harness'

await new Command()
    .name('e2e')
    .description('Loopback-only runner integration against real pinned Pi')
    .option('--record', 'refresh recorded protocol fixtures')
    .action(async (options: { record?: boolean }) => {
        await e2e(options.record ?? false)
    })
    .parseAsync()
