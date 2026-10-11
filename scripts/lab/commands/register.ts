import { Option } from 'commander'

import { SCENARIOS } from '../lib/constants'
import { local, resultCode, resultFor } from '../lib/local'
import { both, remote } from '../lib/remote'

import type { Command } from 'commander'

import type { Options } from '../lib/types'

/**
 * Run the selected host(s), keeping stdout reserved for one terminal JSON object.
 * @param scenario - named scenario or exec
 * @param options - commander options
 * @param argv - ft argv for ad hoc execution
 * @returns completion of result output
 */
async function execute(scenario: string, options: Options, argv: string[] = []): Promise<void> {
    let result

    if (scenario.startsWith('real-') && options.host !== 'local') {
        result = resultFor(scenario, options.host)
        result.outcome = 'prerequisite_error'
        result.error = 'Real checks are local-only and must be explicitly named'
    } else if (options.host === 'both') {
        result = both(
            [
                await local(scenario, { ...options, host: 'local' }, argv),
                await remote(scenario, options, argv),
            ],
            scenario,
        )
    } else if (options.host === 'air' && process.env.FT_LAB_REMOTE !== '1') {
        result = await remote(scenario, options, argv)
    } else {
        result = await local(scenario, options, argv)
    }

    process.stdout.write(`${JSON.stringify(result)}\n`)
    process.exitCode = resultCode(result)
}

/**
 * Add common scratch lifecycle options to a command.
 * @param command - command receiving options
 * @param hosts - allowed host choices
 * @returns configured command
 */
function scratchOptions(command: Command, hosts: string[]): Command {
    return command
        .addOption(
            new Option('--host <host>', 'native execution host; both runs local then air')
                .choices(hosts)
                .default('local'),
        )
        .option('--keep', 'retain only this run directory and its unchanged diagnostic artifacts')
        .option(
            '--cold',
            'use fresh build and runtime caches (offline archive fixtures still reused)',
        )
        .option(
            '--archives <dir>',
            'directory of previously acquired pinned Pi/rg/fd archives; never download implicitly',
        )
}

/**
 * Register the thin commander surface; all execution logic lives in program-root lib.
 * @param program - sole lab commander entrypoint
 * @returns nothing
 */
export function register(program: Command): void {
    program
        .command('list')
        .description('List named scenarios and their assertions; real checks never run implicitly')
        .option('--json', 'machine-readable scenario catalog')
        .action(() => {
            process.stdout.write(
                `${JSON.stringify({ schemaVersion: 1, scenarios: Object.entries(SCENARIOS).map(([name, assertions]) => ({ name, assertions, explicitOnly: name.startsWith('real-'), prerequisites: ({ 'real-gateway': 'Linux, --project .ft.json, real key reference; paid smart/cheap tool turns', 'real-release': '--version, authenticated real gh; contacts GitHub' } as Record<string, string>)[name] ?? 'native Bun, tar, offline pinned runtime archives where needed', scope: 'Scratch environment, not a security sandbox' })) })}\n`,
            )
        })
    scratchOptions(
        program
            .command('run <scenario>')
            .description('Run exactly one named scenario; no default suite'),
        ['local', 'air', 'both'],
    )
        .option(
            '--project <dir>',
            'real-gateway ONLY: Linux project .ft.json with actual apiKey reference; two paid tool round trips, 90s per lane',
        )
        .option(
            '--version <version>',
            'real-release ONLY: exact published version, cold install.sh and actual authenticated gh; no model requests',
        )
        .action(async (scenario: string, inputs: Options) => {
            await execute(scenario, inputs)
        })
    scratchOptions(
        program
            .command('exec [argv...]')
            .description(
                'Run arbitrary ft argv in scratch HOME/cache/project; tools retain your permissions',
            )
            .allowUnknownOption()
            .passThroughOptions(),
        ['local', 'air'],
    ).action(async (argv: string[], inputs: Options) => {
        await execute('exec', inputs, argv)
    })
}
