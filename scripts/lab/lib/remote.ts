import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { AIR_TOOLCHAIN, LAB_ROOT } from './constants'
import { phase, readResult, resultFor } from './local'
import { command, PrerequisiteError, start } from './processes'
import { pinnedBunVersion } from './toolchain'

import type { Aggregate, Options, Result } from './types'

/**
 * Quote one literal argument for the SSH remote shell.
 * @param value - literal value
 * @returns POSIX shell word
 */
function quote(value: string): string {
    return `'${value.replaceAll("'", String.raw`'\''`)}'`
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
 * @param scenarios - selected non-real scenarios or exec
 * @param options - remote options
 * @param argv - literal exec arguments
 * @returns copied structured remote results
 */
export async function remote(
    scenarios: string[],
    options: Options,
    argv: string[],
): Promise<Result[]> {
    const result = resultFor(scenarios.join(','), 'air')
    const results: Result[] = []

    try {
        if (options.artifacts) {
            throw new PrerequisiteError(
                '--artifacts tests binaries already on this machine; run it on the host that built them',
            )
        }

        if (scenarios.some(scenario => scenario.startsWith('real-'))) {
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
                /* Skip what each folder's .gitignore ignores, such as the runs under .ft/runs. */
                '--filter=:- .gitignore',
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

        /* The Air's output prints once a phase ends, so it never writes over the spinner. */
        const toolchain = await phase(result, 'toolchain', async () => {
            const output = await command(['ssh', 'air', toolchainScript(bunVersion)])

            return output.stderr
        })

        process.stderr.write(toolchain)

        const dependencies = await phase(result, 'dependencies', async () => {
            const script = `set -eu
cd ${LAB_ROOT}/checkout
current="$(shasum -a 256 bun.lock) bun-${bunVersion}"
previous=$(cat ${LAB_ROOT}/cache/bun-lock.sha 2>/dev/null || :)
if [ "$current" != "$previous" ] || [ ! -d node_modules ]; then
    HOME=${LAB_ROOT}/home XDG_CACHE_HOME=${LAB_ROOT}/cache TMPDIR=${LAB_ROOT} BUN_INSTALL_CACHE_DIR=${LAB_ROOT}/cache/bun HUSKY=0 ${bun} install --frozen-lockfile >&2
    printf '%s' "$current" > ${LAB_ROOT}/cache/bun-lock.sha
fi`
            const output = await command(['ssh', 'air', script])

            return output.stderr
        })

        process.stderr.write(dependencies)

        const arguments_ =
            scenarios[0] === 'exec'
                ? ['exec', '--host', 'air']
                : ['run', ...scenarios, '--host', 'air']

        if (options.cold) {
            arguments_.push('--cold')
        }

        arguments_.push('--keep')

        if (scenarios[0] === 'exec') {
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

        const envelope = JSON.parse(capture.stdout) as Result | Aggregate
        const candidates = 'results' in envelope ? envelope.results : [envelope]

        if (
            envelope.schemaVersion !== 1 ||
            envelope.host !== 'air' ||
            candidates.length !== scenarios.length ||
            candidates.some(
                (candidate, index) =>
                    !/^\d+-[a-f0-9]{8}$/.test(candidate.runId) ||
                    candidate.schemaVersion !== 1 ||
                    candidate.host !== 'air' ||
                    candidate.scenario !== scenarios[index],
            )
        ) {
            throw new Error('Invalid remote result identity')
        }

        await mkdir(join(LAB_ROOT, 'results'), { recursive: true, mode: 0o700 })

        for (const candidate of candidates) {
            const copy = join(LAB_ROOT, 'results', `air-${candidate.runId}.json`)

            await command(['rsync', '-az', `air:${LAB_ROOT}/results/${candidate.runId}.json`, copy])

            const copied = await readResult(copy)

            if (
                copied.runId !== candidate.runId ||
                copied.host !== 'air' ||
                copied.scenario !== candidate.scenario
            ) {
                throw new Error('Copied remote result identity mismatch')
            }

            results.push(copied)

            if (!options.keep) {
                try {
                    await phase(copied, 'remote-cleanup', () =>
                        command(['ssh', 'air', `rm -rf ${LAB_ROOT}/runs/${candidate.runId}`]),
                    )
                    copied.cleanup = { outcome: 'removed' }
                    copied.keptPaths = []
                } catch (error) {
                    copied.cleanup = { outcome: 'failed', error: String(error) }
                    throw error
                }
            }

            if (results.length === 1) {
                Object.assign(
                    copied.phases,
                    Object.fromEntries(
                        Object.entries(result.phases).map(([name, ms]) => [
                            `transport-${name}`,
                            ms,
                        ]),
                    ),
                )
            }

            await writeFile(copy, JSON.stringify(copied, null, 4))
        }
    } catch (error) {
        for (const [index, scenario] of scenarios.entries()) {
            const failed = results[index] ?? resultFor(scenario, 'air')

            failed.outcome = error instanceof PrerequisiteError ? 'prerequisite_error' : 'lab_error'
            failed.error = error instanceof Error ? error.message : String(error)
            results[index] = failed
        }
    }

    return results
}
