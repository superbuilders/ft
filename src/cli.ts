import { Command } from 'commander'

import { doctor } from './commands/doctor/doctor'
import { guide } from './commands/guide/guide'
import { init } from './commands/init/init'
import { key } from './commands/key/key'
import { list } from './commands/list/list'
import { pin } from './commands/pin/pin'
import { exec, run, start } from './commands/run/run'
import { schema } from './commands/schema/schema'
import { show } from './commands/show/show'
import { skill } from './commands/skill/skill'
import { stop } from './commands/stop/stop'
import { watch } from './commands/watch/watch'
import { RUNNER_VERSION } from './version'

import type { RunOptions } from './commands/run/types'

const program = new Command()
    .name('ft')
    .version(RUNNER_VERSION)
    .addHelpText('after', '\nAgents: run ft guide for how to use ft in this project.')

/**
 * Give run and start the same options.
 * @param command - run or start
 * @returns the command, for chaining
 */
function runOptions(command: Command): Command {
    return command
        .option('--name <name>', 'start of the run id (default: the brief file name)')
        .option('--lane <name>', 'configured lane (default: code)')
        .option('--model <ref>', 'provider/model, instead of a lane')
        .option('--profile <profile>', 'read (default) or write tools')
        .option('--thinking <level>', 'thinking override')
        .option('--deadline <seconds>', 'stop the run after this long')
        .option('--cwd <dir>', 'directory the run works in')
        .option('--out <path>', 'also write the answer here; removed if the run fails')
        .option('--json', 'print the status as JSON')
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
        .description('Start briefs detached; ft watch collects them')
        .argument('<briefs...>', 'brief files, or - for stdin'),
).action(async (briefs: string[], options: RunOptions) => {
    process.exitCode = await start(briefs, options)
})
program
    .command('watch')
    .description('Watch runs until they finish and print each report (default: every running run)')
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
    .command('show <id>')
    .description('Tell the story of one run: every step and the answer')
    .option('--json', 'print the status as JSON')
    .action(show)
program
    .command('stop <ids...>')
    .description('Cancel running runs')
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
    .description('Set ft up in this repository, or with --user for you in every repository')
    .option('--user', 'set ft up for you rather than this repository')
    .option('--from <file>', 'copy this .ft.json instead of starting an empty one')
    .action((version: string | undefined, options: { user?: boolean; from?: string }) =>
        init(version ?? RUNNER_VERSION, options),
    )
program
    .command('pin <version>')
    .description('Pin a runner release for this repository, or with --user for you')
    .option('--user', "pin your personal config rather than this repository's")
    .action(pin)
program
    .command('skill')
    .description('Add the agent skill to this repository, or with --user for you')
    .option('--user', 'put it in your home directory, for every repository')
    .action(skill)
program.command('schema').description('Print the JSON Schema for .ft.json').action(schema)
program
    .command('doctor')
    .description('Show config and runtime health')
    .action(() => doctor(RUNNER_VERSION))

try {
    await program.parseAsync()
} catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'ft failed'}\n`)
    process.exitCode = program.args[0] === 'key' ? 1 : 2
}
