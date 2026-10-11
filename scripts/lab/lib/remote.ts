import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { AIR_TOOLCHAIN, LAB_ROOT } from './constants'
import { phase, readResult, resultCode, resultFor } from './local'
import { command, PrerequisiteError, start } from './processes'

import type { Options, Result } from './types'

/**
 * Quote one literal argument for the SSH remote shell.
 * @param value - literal value
 * @returns POSIX shell word
 */
function quote(value: string): string {
    return `'${value.replaceAll("'", String.raw`'\''`)}'`
}

/**
 * Read the Bun version CI builds with, from package.json's packageManager field.
 * @returns exact version such as 1.3.13
 */
async function pinnedBunVersion(): Promise<string> {
    const manifest = (await Bun.file(join(process.cwd(), 'package.json')).json()) as {
        packageManager?: string
    }
    const version = /^bun@(\d+\.\d+\.\d+)/.exec(manifest.packageManager ?? '')?.[1]

    if (!version) {
        throw new PrerequisiteError('package.json packageManager must pin bun@<version>')
    }

    return version
}

/**
 * Remote script that installs the pinned Bun under the lab root once, verified against
 * the release's SHASUMS256.txt, using only curl, shasum and unzip from the base system.
 * @param version - exact Bun version
 * @returns POSIX sh script
 */
function toolchainScript(version: string): string {
    const directory = `${AIR_TOOLCHAIN}/bun-${version}`
    const release = `https://github.com/oven-sh/bun/releases/download/bun-v${version}`

    return `set -eu
[ -x ${directory}/bun ] && exit 0
case $(uname -m) in arm64) asset=bun-darwin-aarch64 ;; *) asset=bun-darwin-x64 ;; esac
umask 077
mkdir -p ${AIR_TOOLCHAIN}
stage=$(mktemp -d ${AIR_TOOLCHAIN}/stage.XXXXXX)
trap 'rm -rf "$stage"' 0
curl -fsSL -o "$stage/$asset.zip" ${release}/$asset.zip
curl -fsSL -o "$stage/SHASUMS256.txt" ${release}/SHASUMS256.txt
expected=$(grep " $asset.zip$" "$stage/SHASUMS256.txt" | cut -d' ' -f1)
actual=$(shasum -a 256 "$stage/$asset.zip" | cut -d' ' -f1)
[ -n "$expected" ] && [ "$expected" = "$actual" ] || { echo "bun ${version} checksum mismatch" >&2; exit 1; }
unzip -q "$stage/$asset.zip" -d "$stage"
mkdir "$stage/out"
mv "$stage/$asset/bun" "$stage/out/bun"
mv "$stage/out" ${directory}`
}

/**
 * Sync the working tree and execute the same host-local command natively on air.
 * Only /tmp/ft-lab is writable; gh and keychain access are never used remotely.
 * @param scenario - selected non-real scenario or exec
 * @param options - remote options
 * @param argv - literal exec arguments
 * @returns copied structured remote result
 */
export async function remote(scenario: string, options: Options, argv: string[]): Promise<Result> {
    let result = resultFor(scenario, 'air')
    const transport: Record<string, number> = {}

    try {
        if (scenario.startsWith('real-')) {
            throw new PrerequisiteError(
                'Real scenarios are local-only; lab never forwards credentials or runs gh on air',
            )
        }

        await phase(result, 'sync', async () => {
            await command([
                'ssh',
                'air',
                `umask 077; mkdir -p ${LAB_ROOT}/checkout ${LAB_ROOT}/cache ${LAB_ROOT}/runs ${LAB_ROOT}/results ${LAB_ROOT}/home`,
            ])
            await command([
                'rsync',
                '-az',
                '--delete',
                '--exclude=node_modules',
                '--exclude=tmp',
                '--exclude=.git',
                `${process.cwd()}/`,
                `air:${LAB_ROOT}/checkout/`,
            ])

            if (options.archives) {
                await command(['ssh', 'air', `mkdir -p ${LAB_ROOT}/cache/archives`])
                await command([
                    'rsync',
                    '-az',
                    `${resolve(options.archives)}/`,
                    `air:${LAB_ROOT}/cache/archives/`,
                ])
            }
        })

        const bunVersion = await pinnedBunVersion()
        const bun = `${AIR_TOOLCHAIN}/bun-${bunVersion}/bun`

        await phase(result, 'toolchain', async () => {
            const output = await command(['ssh', 'air', toolchainScript(bunVersion)])

            process.stderr.write(output.stderr)
        })
        await phase(result, 'dependencies', async () => {
            const script = `set -eu
cd ${LAB_ROOT}/checkout
current="$(shasum -a 256 bun.lock) bun-${bunVersion}"
previous=$(cat ${LAB_ROOT}/cache/bun-lock.sha 2>/dev/null || :)
if [ "$current" != "$previous" ] || [ ! -d node_modules ]; then
    HOME=${LAB_ROOT}/home XDG_CACHE_HOME=${LAB_ROOT}/cache TMPDIR=${LAB_ROOT} BUN_INSTALL_CACHE_DIR=${LAB_ROOT}/cache/bun HUSKY=0 ${bun} install --frozen-lockfile >&2
    printf '%s' "$current" > ${LAB_ROOT}/cache/bun-lock.sha
fi`
            const output = await command(['ssh', 'air', script])

            process.stderr.write(output.stderr)
        })

        const arguments_ =
            scenario === 'exec' ? ['exec', '--host', 'air'] : ['run', scenario, '--host', 'air']

        if (options.cold) {
            arguments_.push('--cold')
        }

        arguments_.push('--keep')

        if (scenario === 'exec') {
            arguments_.push('--', ...argv)
        }

        const capture = await phase(
            result,
            'remote',
            () =>
                start(
                    undefined,
                    [
                        'ssh',
                        'air',
                        `cd ${LAB_ROOT}/checkout && FT_LAB_REMOTE=1 HOME=${LAB_ROOT}/home XDG_CACHE_HOME=${LAB_ROOT}/cache TMPDIR=${LAB_ROOT} ${bun} scripts/lab ${arguments_.map(quote).join(' ')}`,
                    ],
                    process.cwd(),
                    process.env,
                ).result,
        )

        process.stderr.write(capture.stderr)
        Object.assign(transport, result.phases)

        const candidate = JSON.parse(capture.stdout) as Result

        if (
            !/^\d+-[a-f0-9]{8}$/.test(candidate.runId) ||
            candidate.schemaVersion !== 1 ||
            candidate.host !== 'air'
        ) {
            throw new Error('Invalid remote result identity')
        }

        const copy = join(LAB_ROOT, 'results', `air-${candidate.runId}.json`)

        await mkdir(join(LAB_ROOT, 'results'), { recursive: true, mode: 0o700 })
        await command(['rsync', '-az', `air:${LAB_ROOT}/results/${candidate.runId}.json`, copy])
        result = await readResult(copy)

        if (!options.keep) {
            try {
                await phase(result, 'remote-cleanup', () =>
                    command(['ssh', 'air', `rm -rf ${LAB_ROOT}/runs/${candidate.runId}`]),
                )
                result.cleanup = { outcome: 'removed' }
                result.keptPaths = []
            } catch (error) {
                result.cleanup = { outcome: 'failed', error: String(error) }
                throw error
            }
        }

        result.phases = {
            ...result.phases,
            ...Object.fromEntries(
                Object.entries(transport).map(([name, ms]) => [`transport-${name}`, ms]),
            ),
        }
        await writeFile(copy, JSON.stringify(result, null, 4))
    } catch (error) {
        result.outcome = error instanceof PrerequisiteError ? 'prerequisite_error' : 'lab_error'
        result.error = error instanceof Error ? error.message : String(error)
    }

    return result
}

/**
 * Aggregate local-then-air without emitting multiple stdout objects.
 * @param results - ordered host results
 * @param scenario - requested scenario
 * @returns combined verdict and nested per-host evidence
 */
export function both(results: Result[], scenario: string): Result {
    const result = resultFor(scenario, 'both')
    const worst = Math.max(...results.map(resultCode))

    result.results = results
    result.outcome =
        (['passed', 'failed', 'prerequisite_error', 'lab_error'] as const)[worst] ?? 'lab_error'
    result.assertions = results.flatMap(host =>
        host.assertions.map(assertion => ({
            ...assertion,
            name: `${host.host}:${assertion.name}`,
        })),
    )
    result.keptPaths = results.flatMap(host => host.keptPaths)

    if (results.some(host => host.cleanup.outcome === 'failed')) {
        result.cleanup.outcome = 'failed'
    } else if (results.some(host => host.cleanup.outcome === 'kept')) {
        result.cleanup.outcome = 'kept'
    }

    return result
}
