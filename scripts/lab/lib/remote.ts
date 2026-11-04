import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { LAB_ROOT, REMOTE_TOOLCHAIN, SSH_HOST_REQUIRED } from './constants'
import { phase, resultFor } from './local'
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
 * the release's SHASUMS256.txt, using curl, sha256sum or shasum, and unzip.
 * @param version - exact Bun version
 * @returns POSIX sh script
 */
function toolchainScript(version: string): string {
    const directory = `${REMOTE_TOOLCHAIN}/bun-${version}`
    const release = `https://github.com/oven-sh/bun/releases/download/bun-v${version}`

    return `set -eu
[ -x ${directory}/bun ] && exit 0
case $(uname -s) in
    Darwin) os=darwin ;;
    Linux) os=linux ;;
    *) echo "Unsupported remote OS" >&2; exit 1 ;;
esac
case $(uname -m) in
    arm64|aarch64) arch=aarch64 ;;
    x86_64) arch=x64 ;;
    *) echo "Unsupported remote architecture" >&2; exit 1 ;;
esac
asset=bun-$os-$arch
umask 077
mkdir -p ${REMOTE_TOOLCHAIN}
stage=$(mktemp -d ${REMOTE_TOOLCHAIN}/stage.XXXXXX)
trap 'rm -rf "$stage"' 0
curl -fsSL -o "$stage/$asset.zip" ${release}/$asset.zip
curl -fsSL -o "$stage/SHASUMS256.txt" ${release}/SHASUMS256.txt
expected=$(grep " $asset.zip$" "$stage/SHASUMS256.txt" | cut -d' ' -f1)
if command -v sha256sum >/dev/null 2>&1; then
    actual=$(sha256sum "$stage/$asset.zip" | cut -d' ' -f1)
else
    actual=$(shasum -a 256 "$stage/$asset.zip" | cut -d' ' -f1)
fi
[ -n "$expected" ] && [ "$expected" = "$actual" ] || { echo "bun ${version} checksum mismatch" >&2; exit 1; }
unzip -q "$stage/$asset.zip" -d "$stage"
mkdir "$stage/out"
mv "$stage/$asset/bun" "$stage/out/bun"
mv "$stage/out" ${directory}`
}

/**
 * Sync the working tree and execute the same host-local command natively over SSH.
 * Only /tmp/ft-lab is writable; credentials and keychain access are never used remotely.
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
    const result = resultFor(scenarios.join(','), 'remote')
    const results: Result[] = []

    try {
        const destination = options.sshHost

        if (!destination) {
            throw new PrerequisiteError(SSH_HOST_REQUIRED)
        }

        if (options.artifacts) {
            throw new PrerequisiteError(
                '--artifacts tests binaries already on this machine; run it on the host that built them',
            )
        }

        if (scenarios.some(scenario => scenario.startsWith('real-'))) {
            throw new PrerequisiteError(
                'Real scenarios are local-only; lab never forwards credentials or checks live releases remotely',
            )
        }

        await phase(result, 'sync', async () => {
            await command([
                'ssh',
                destination,
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
                `${destination}:${LAB_ROOT}/checkout/`,
            ])

            if (options.archives) {
                await command(['ssh', destination, `mkdir -p ${LAB_ROOT}/cache/archives`])
                await command([
                    'rsync',
                    '-az',
                    `${resolve(options.archives)}/`,
                    `${destination}:${LAB_ROOT}/cache/archives/`,
                ])
            }
        })

        const bunVersion = await pinnedBunVersion()
        const bun = `${REMOTE_TOOLCHAIN}/bun-${bunVersion}/bun`

        /* Remote output prints once a phase ends, so it never writes over the spinner. */
        const toolchain = await phase(result, 'toolchain', async () => {
            const output = await command(['ssh', destination, toolchainScript(bunVersion)])

            return output.stderr
        })

        process.stderr.write(toolchain)

        const dependencies = await phase(result, 'dependencies', async () => {
            const script = `set -eu
cd ${LAB_ROOT}/checkout
if command -v sha256sum >/dev/null 2>&1; then
    checksum=$(sha256sum bun.lock)
else
    checksum=$(shasum -a 256 bun.lock)
fi
current="$checksum bun-${bunVersion}"
previous=$(cat ${LAB_ROOT}/cache/bun-lock.sha 2>/dev/null || :)
if [ "$current" != "$previous" ] || [ ! -d node_modules ]; then
    HOME=${LAB_ROOT}/home XDG_CACHE_HOME=${LAB_ROOT}/cache TMPDIR=${LAB_ROOT} BUN_INSTALL_CACHE_DIR=${LAB_ROOT}/cache/bun HUSKY=0 ${bun} install --frozen-lockfile >&2
    printf '%s' "$current" > ${LAB_ROOT}/cache/bun-lock.sha
fi`
            const output = await command(['ssh', destination, script])

            return output.stderr
        })

        process.stderr.write(dependencies)

        const arguments_ =
            scenarios[0] === 'exec'
                ? ['exec', '--host', 'remote']
                : ['run', ...scenarios, '--host', 'remote']

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
                        destination,
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
            envelope.host !== 'remote' ||
            candidates.length !== scenarios.length ||
            candidates.some(
                (candidate, index) =>
                    !/^\d+-[a-f0-9]{8}$/.test(candidate.runId) ||
                    candidate.schemaVersion !== 1 ||
                    candidate.host !== 'remote' ||
                    candidate.scenario !== scenarios[index],
            )
        ) {
            throw new Error('Invalid remote result identity')
        }

        await mkdir(join(LAB_ROOT, 'results'), { recursive: true, mode: 0o700 })

        for (const candidate of candidates) {
            const copy = join(LAB_ROOT, 'results', `remote-${candidate.runId}.json`)

            await writeFile(copy, JSON.stringify(candidate, null, 4), { mode: 0o600 })
            results.push(candidate)

            if (!options.keep) {
                try {
                    await phase(candidate, 'remote-cleanup', () =>
                        command(['ssh', destination, `rm -rf ${LAB_ROOT}/runs/${candidate.runId}`]),
                    )
                    candidate.cleanup = { outcome: 'removed' }
                    candidate.keptPaths = []
                } catch (error) {
                    candidate.cleanup = { outcome: 'failed', error: String(error) }
                    throw error
                }
            }

            if (results.length === 1) {
                Object.assign(
                    candidate.phases,
                    Object.fromEntries(
                        Object.entries(result.phases).map(([name, ms]) => [
                            `transport-${name}`,
                            ms,
                        ]),
                    ),
                )
            }

            await writeFile(copy, JSON.stringify(candidate, null, 4))
        }
    } catch (error) {
        for (const [index, scenario] of scenarios.entries()) {
            const failed = results[index] ?? resultFor(scenario, 'remote')

            failed.outcome = error instanceof PrerequisiteError ? 'prerequisite_error' : 'lab_error'
            failed.error = error instanceof Error ? error.message : String(error)
            results[index] = failed
        }
    }

    return results
}
