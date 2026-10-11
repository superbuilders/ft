import { Command } from 'commander'

import { version } from '../package.json'

new Command().name('ft').version(version).parse()
