import { Option } from 'commander'

import { SCENARIOS } from '../lib/constants'
import { local, resultCode, resultFor } from '../lib/local'
import { remote } from '../lib/remote'
import { aggregate, selectScenarios, summarize } from '../lib/results'

import type { Command } from 'commander'

import type { Options, Result } from '../lib/types'

/**
 * Run the selected host(s), keeping stdout reserved for one terminal JSON object.
 * @param scenarios - named scenarios or exec
 * @param options - commander options
 * @param argv - ft argv for ad hoc execution
 * @returns completion of result output
 */
async function execute(scenarios: string[], options: Options, argv: string[] = []): Promise<void> {
    const results: Result[] = []

    if (scenarios.some(scenario => scenario.startsWith('real-')) && options.host !== 'local') {
        for (const scenario of scenarios) {
            const result = resultFor(scenario, options.host)

            result.outcome = 'prerequisite_error'
            result.error = 'Real checks are local-only and must be explicitly named'
            results.push(result)
            summarize(result)
        }
    }

    const hosts = options.host === 'both' ? (['local', 'air'] as const) : [options.host]

    for (const host of results.length ? [] : hosts) {
        let completed: Result[]

        if (host === 'air' && process.env.FT_LAB_REMOTE !== '1') {
            completed = await remote(scenarios, options, argv)
            completed.forEach(summarize)
        } else {
            completed = await local(scenarios, { ...options, host }, argv)
        }

        results.push(...completed)
    }

    const result = results.length === 1 ? results[0] : aggregate(results, options.host)

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
            'directory of pinned Pi/rg/fd archives; missing ones are downloaded once and verified',
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
        .option('--json', 'print the catalog as JSON')
        .action(() => {
            process.stdout.write(
                `${JSON.stringify({ schemaVersion: 1, scenarios: Object.entries(SCENARIOS).map(([name, assertions]) => ({ name, assertions, explicitOnly: name.startsWith('real-'), prerequisites: ({ 'real-gateway': 'Linux, --project with real .ft.json providers; paid code-lane tool turn and research question', 'real-release': '--version, authenticated real gh; contacts GitHub' } as Record<string, string>)[name] ?? 'native Bun, tar, offline pinned runtime archives where needed', scope: 'Scratch environment, not a security sandbox' })) })}\n`,
            )
        })
    scratchOptions(
        program
            .command('run [scenario...]')
            .description(
                'Run the named scenarios, or --all for every scenario except the real checks',
            ),
        ['local', 'air', 'both'],
    )
        .option('--all', 'run every non-real scenario; never includes real checks')
        .option(
            '--artifacts <dir>',
            'test the ft-<target> binary in this folder instead of compiling; local host only',
        )
        .option(
            '--project <dir>',
            'real-gateway ONLY: a project whose .ft.json has real code and research lanes (Linux only; two paid runs, 90s each)',
        )
        .option(
            '--version <version>',
            'real-release ONLY: install this published version fresh with install.sh and your signed-in gh (no model requests)',
        )
        .action(async (scenarios: string[], inputs: Options) => {
            await execute(selectScenarios(scenarios, inputs.all), inputs)
        })
    scratchOptions(
        program
            .command('exec [argv...]')
            .description(
                'Run any ft command in a throwaway home, cache and project (tools keep your permissions)',
            )
            .allowUnknownOption()
            .passThroughOptions(),
        ['local', 'air'],
    ).action(async (argv: string[], inputs: Options) => {
        await execute(['exec'], inputs, argv)
    })
}
