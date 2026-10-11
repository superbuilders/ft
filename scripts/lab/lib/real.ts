import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

import { validateConfig } from '../../../src/config'
import { TARGETS } from '../../../src/constants'
import { liveResearch, liveToolTurn } from './harness'
import { check, PrerequisiteError, start } from './processes'

import type { Context, Options } from './types'

/**
 * Explicitly authorized Linux-only gateway smoke using the project's key reference.
 * No key is resolved by the lab, copied to scratch files or printed.
 * @param context - scratch runtime and compiled runner
 * @param options - explicitly supplied real project
 * @returns completion of both paid tool round trips
 */
export async function realGateway(context: Context, options: Options): Promise<void> {
    if (process.platform !== 'linux' || !options.project) {
        throw new PrerequisiteError(
            'real-gateway requires Linux and --project <dir> with .ft.json; it makes paid requests',
        )
    }

    const project = resolve(options.project)
    const path = join(project, '.ft.json')

    if (!existsSync(path)) {
        throw new PrerequisiteError(`Missing project config: ${path}`)
    }

    const config = validateConfig(JSON.parse(await readFile(path, 'utf8')))
    const key = join(context.project, 'real-key.ts')

    await writeFile(
        key,
        `const env = { ...process.env, FT_CONFIG: ${JSON.stringify(path)} }; delete env.FT_KEY_SOCKET;
const child = Bun.spawn(${JSON.stringify([context.build.binary, 'key'])}, { cwd: ${JSON.stringify(project)}, env, stdin: 'ignore', stdout: 'pipe', stderr: 'ignore' });
const output = await new Response(child.stdout).text();
if (await child.exited !== 0) process.exit(1);
process.stdout.write(output);
`,
    )
    await writeFile(
        join(context.project, '.ft.json'),
        JSON.stringify(
            {
                ...config,
                version: context.build.version,
                sha256: Object.fromEntries(
                    TARGETS.map(target => [
                        target,
                        target === context.build.target ? context.build.digest : '0'.repeat(64),
                    ]),
                ),
                apiKey:
                    'env' in config.apiKey ? config.apiKey : { command: [process.execPath, key] },
            },
            null,
            4,
        ),
    )
    context.env.PATH = process.env.PATH

    if ('env' in config.apiKey) {
        const value = process.env[config.apiKey.env]

        if (!value) {
            throw new PrerequisiteError('Configured real apiKey environment variable is unset')
        }

        context.env[config.apiKey.env] = value
    }

    delete context.env.BUN_OPTIONS
    await writeFile(
        join(context.project, 'brief.md'),
        'Call bash exactly once with command "printf ft-real-tool-ok", then report ft-real-tool-ok. Do not read, edit or write any other files. Do not call other tools.',
    )

    for (const lane of ['smart', 'cheap']) {
        await liveToolTurn(context, lane)
    }

    await liveResearch(context)
}

/**
 * Explicit published-version cold install through actual gh; never offered remotely.
 * @param context - scratch HOME, installation and cache
 * @param options - published version supplied by the caller
 * @returns completion of live distribution checks
 */
export async function realRelease(context: Context, options: Options): Promise<void> {
    if (!options.version || !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(options.version)) {
        throw new PrerequisiteError(
            'real-release requires --version <published-version>; uses authenticated real gh and GitHub',
        )
    }

    const gh = Bun.which('gh')

    if (!gh) {
        throw new PrerequisiteError('real-release requires gh on the caller PATH')
    }

    const env = {
        ...context.env,
        PATH: process.env.PATH,
        GH_CONFIG_DIR: process.env.GH_CONFIG_DIR ?? join(homedir(), '.config', 'gh'),
        GH_TOKEN: process.env.GH_TOKEN,
        GITHUB_TOKEN: process.env.GITHUB_TOKEN,
        BUN_OPTIONS: '',
    }
    const install = await start(
        context,
        ['sh', resolve('install.sh'), options.version],
        context.project,
        env,
    ).result

    check(context.result, 'installer', 0, install.code)

    if (install.code !== 0) {
        return
    }

    const sums = await start(
        context,
        [
            gh,
            'release',
            'download',
            `v${options.version}`,
            '-R',
            'superbuilders/ft',
            '-p',
            'SHA256SUMS',
            '-O',
            '-',
        ],
        context.project,
        env,
    ).result
    const hashes = Object.fromEntries(
        TARGETS.map(target => [
            target,
            new RegExp(`^([a-fA-F0-9]{64})  ft-${target}$`, 'm').exec(sums.stdout)?.[1] ?? '',
        ]),
    )

    await writeFile(
        join(context.project, '.ft.json'),
        JSON.stringify(
            { version: options.version, sha256: hashes, apiKey: { env: 'UNUSED_LAB_KEY' } },
            null,
            4,
        ),
    )

    const capture = await start(
        context,
        [join(join(context.directory, 'install'), 'ft'), '--version'],
        context.project,
        env,
    ).result

    check(
        context.result,
        'published-version',
        { code: 0, version: options.version },
        { code: capture.code, version: capture.stdout.trim() },
    )
    check(
        context.result,
        'cold-runner',
        true,
        existsSync(join(join(context.directory, 'xdg'), 'ft', 'runner', options.version, 'ft')),
    )
}
