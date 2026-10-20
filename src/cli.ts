import { Command } from 'commander'

import { doctor } from './commands/doctor/doctor'
import { guide } from './commands/guide/guide'
import { init } from './commands/init/init'
import { key } from './commands/key/key'
import { list } from './commands/list/list'
import { HELP_STYLES, printFailure } from './commands/output/output'
import { pin } from './commands/pin/pin'
import { roles } from './commands/roles/roles'
import { exec, run, start, thinkingHelp } from './commands/run/run'
import { schema } from './commands/schema/schema'
import { show } from './commands/show/show'
import { skill } from './commands/skill/skill'
import { steer } from './commands/steer/steer'
import { stop } from './commands/stop/stop'
import { uninstall } from './commands/uninstall/uninstall'
import { upgrade } from './commands/upgrade/upgrade'
import { watch } from './commands/watch/watch'
import { RUNNER_VERSION } from './version'

import type { RunOptions } from './commands/run/types'

const program = new Command()
    .name('ft')
    .version(RUNNER_VERSION)
    .configureHelp(HELP_STYLES)
    .addHelpText('after', '\nAgents: run ft guide to learn how to use ft in this project')

/**
 * Give run and start the same options.
 * @param command - run or start
 * @returns the command, for chaining
 */
function runOptions(command: Command): Command {
    return command
        .option('--name <name>', 'run id prefix (default: the brief file name)')
        .option('--role <name>', 'configured role (default: code)')
        .option('--model <ref>', 'provider/model, instead of a role')
        .option('--profile <profile>', 'tool profile: read (default) or write')
        .option('--thinking <level>', thinkingHelp())
        .option(
            '--workdir <dir>',
            'folder the run works in, such as a worktree (default: this one)',
        )
        .option('--deadline <seconds>', 'stop the run after this long')
        .option(
            '--output-schema <file>',
            'a JSON Schema the final answer must match; the answer is saved as output.json',
        )
        .option(
            '--out <path>',
            'also save the answer here (an existing file is replaced, or deleted if the run fails)',
        )
        .option('--json', 'print the run status as JSON')
}

program
    .command('guide')
    .description('How to use ft, for agents')
    .action(() => guide(RUNNER_VERSION))
runOptions(
    program
        .command('run')
        .description('Run one brief and print its report')
        .argument('<brief>', 'brief file, or - for stdin'),
).action(async (brief: string, options: RunOptions) => {
    process.exitCode = await run(brief, options)
})
runOptions(
    program
        .command('start')
        .description('Start runs in the background; ft watch prints their reports')
        .argument('<briefs...>', 'brief files, or - for stdin'),
).action(async (briefs: string[], options: RunOptions) => {
    process.exitCode = await start(briefs, options)
})
program
    .command('watch')
    .description('Wait for runs to finish and print their reports (default: the runs running now)')
    .argument('[ids...]', 'run ids or prefixes')
    .option('--timeout <seconds>', 'stop watching after this long and exit 75')
    .option('--json', 'print one JSON status per run')
    .action(async (ids: string[], options: { timeout?: string; json?: boolean }) => {
        process.exitCode = await watch(ids, options)
    })
program
    .command('list')
    .description("List this project's runs, newest first")
    .option('--all', 'include every finished run')
    .option('--json', 'print one JSON status per run')
    .action(list)
program
    .command('roles')
    .description('List the roles configured here, and which one is the default')
    .option('--json', 'print one JSON object per role')
    .action(roles)
program
    .command('show <id>')
    .description("Show a run's steps and its answer")
    .option('--json', 'print the run status as JSON')
    .action(show)
program
    .command('steer <id> <message>')
    .description(
        'Send a running run a message; its model reads it after its current tool calls (- reads stdin)',
    )
    .option('--json', 'print the receipt as JSON')
    .action(async (id: string, message: string, options: { json?: boolean }) => {
        process.exitCode = await steer(id, message, options)
    })
program
    .command('stop <ids...>')
    .description('Cancel one or more runs')
    .action(async (ids: string[]) => {
        process.exitCode = await stop(ids)
    })
program.addCommand(
    new Command('exec').argument('<dir>').action(async (dir: string) => {
        process.exitCode = await exec(dir)
    }),
    { hidden: true },
)
program.command('key <provider>').description("Print a configured provider's key").action(key)
program
    .command('init [version]')
    .description('Set ft up for this repository, or your personal setup with --user')
    .option('--user', 'set up your personal config instead of this repository')
    .option('--from <file>', 'copy this .ft.json instead of starting an empty one')
    .action((version: string | undefined, options: { user?: boolean; from?: string }) =>
        init(version ?? RUNNER_VERSION, options),
    )
program
    .command('pin [version]')
    .description(
        'Pin an ft version (the newest by default) for this repository, or your personal setup with --user',
    )
    .option('--user', 'pin the version for your personal setup instead of this repository')
    .action(pin)
program
    .command('skill')
    .description('Add the agent skill to this repository, or your personal setup with --user')
    .option('--user', 'put it in your home directory, for every repository')
    .action(skill)
program
    .command('uninstall')
    .description('Remove ft from this machine; your config stays unless you pass --purge')
    .option('--purge', 'also remove your personal config')
    .action(uninstall)
program
    .command('upgrade')
    .alias('update')
    .description('Upgrade ft on this machine to the newest release; repositories keep their pins')
    .action(upgrade)
program.command('schema').description('Print the JSON Schema for .ft.json').action(schema)
program
    .command('doctor')
    .description('Check the config and runtime used here, or your personal setup with --user')
    .option('--user', 'check your personal config instead of the one used here')
    .action(async (options: { user?: boolean }) => {
        process.exitCode = await doctor(RUNNER_VERSION, options)
    })

try {
    await program.parseAsync()
} catch (error) {
    printFailure(error)
    process.exitCode = program.args[0] === 'key' ? 1 : 2
}
