import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
    chmodSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from 'node:fs'
import { hostname, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const shim = resolve('shim/ft')
const installer = resolve('install.sh')
const version = '0.1.0'
const target = 'linux-x64'
const shells = ['sh', ...(spawnSync('dash', ['-c', ':']).status === 0 ? ['dash'] : [])]
const runner = `#!/bin/sh
if [ "\${1:-}" = --version ]; then
    printf '%s\\n' "\${FAKE_SMOKE_VERSION:-0.1.0}"
    exit "\${FAKE_SMOKE_EXIT:-0}"
fi
printf 'runner=0.1.0\\nFT_CONFIG=%s\\n' "\${FT_CONFIG:-unset}"
printf 'PATH=%s\\n' "$PATH"
printf 'arg=<%s>\\n' "$@"
`

/*
 * Inline vendor double for gh's release view/download and auth status/token commands.
 * Release workflow asset names and the real gh CLI argument format are its backstop.
 */
const fakeGh = `#!/bin/sh
printf '%s\\n' "$*" >> "$FAKE_CALLS"
if [ "$1 $2" = 'auth token' ]; then
    printf '%s\\n' 'fake-token-must-not-leak'
    echo 'fake-auth-token-stderr-must-not-leak' >&2
    exit "\${FAKE_AUTH_TOKEN_EXIT:-1}"
fi
if [ "\${FAKE_GH_FAIL:-}" = keychain ]; then
    echo 'HTTP 401: The token is invalid' >&2
    exit 1
fi
if [ "\${FAKE_GH_FAIL:-}" = auth ]; then
    echo 'To get started with GitHub CLI, please run: gh auth login' >&2
    exit 4
fi
if [ "\${FAKE_GH_FAIL:-}" = download ]; then
    echo 'HTTP 500: unavailable' >&2
    exit 1
fi
case "$1 $2" in
    'auth status') exit 0 ;;
    'release view') printf '{"tagName":"v0.1.0"}\\n'; exit 0 ;;
    'release download') ;;
    *) echo 'unexpected gh command' >&2; exit 9 ;;
esac
shift 2
patterns=
destination=
while [ "$#" -gt 0 ]; do
    case $1 in
        -p) patterns="$patterns $2"; shift 2 ;;
        -D) destination=$2; shift 2 ;;
        -R) [ "$2" = superbuilders/ft ] || exit 9; shift 2 ;;
        v0.1.0) shift ;;
        *) exit 9 ;;
    esac
done
if [ -n "\${FAKE_DELAY:-}" ]; then sleep "$FAKE_DELAY"; fi
if [ "\${FAKE_BLOCK:-}" = yes ]; then
    # No child process: signal tests must not leave a sleeper behind.
    while :; do :; done
fi
for asset in $patterns; do
    cat "$FAKE_FIXTURES/$asset" > "$destination/$asset" || exit 1
done
`

let root: string
let project: string
let cwd: string
let cache: string
let fixtures: string
let calls: string
let env: NodeJS.ProcessEnv

function digest(content: string) {
    return createHash('sha256').update(content).digest('hex')
}

function executable(path: string, content: string) {
    writeFileSync(path, content)
    chmodSync(path, 0o755)
}

function configure(
    hashes: Record<string, string> = { [target]: digest(runner) },
    directory = project,
) {
    mkdirSync(join(directory, '.ft'), { recursive: true })
    writeFileSync(join(directory, '.ft.json'), '{}')
    writeFileSync(
        join(directory, '.ft/lock.json'),
        JSON.stringify({ version, sha256: hashes }, null, 4),
    )
}

function ghCalls() {
    return existsSync(calls) ? readFileSync(calls, 'utf8').trim().split('\n') : []
}

function start(shell: string, args: string[], overrides: NodeJS.ProcessEnv = {}, script = shim) {
    const child = spawn(shell, [script, ...args], { cwd, env: { ...env, ...overrides } })
    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString()
    })

    const result = new Promise<{ code: number | null; stdout: string; stderr: string }>(
        (resolveResult, reject) => {
            const timer = setTimeout(() => {
                child.kill('SIGKILL')
                reject(new Error(`Shim timed out: ${stderr}`))
            }, 10_000)

            child.on('error', error => {
                clearTimeout(timer)
                reject(error)
            })
            child.on('close', code => {
                clearTimeout(timer)
                resolveResult({ code, stdout, stderr })
            })
        },
    )

    return { child, result }
}

async function waitFor(predicate: () => boolean) {
    for (let attempt = 0; attempt < 200; attempt += 1) {
        if (predicate()) {
            return
        }

        await new Promise(resolveWait => setTimeout(resolveWait, 10))
    }

    throw new Error('Timed out waiting for shim state')
}

function finalPath() {
    return join(cache, 'ft', 'runner', version, 'ft')
}

function expectClean() {
    for (const directory of ['locks', 'staging']) {
        const path = join(cache, 'ft', directory)

        expect(existsSync(path) ? readdirSync(path) : []).toEqual([])
    }
}

beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'ft-shim-test-'))
    project = join(root, 'project with spaces')
    cwd = join(project, 'nested', 'deep')
    cache = join(root, 'cache')
    fixtures = join(root, 'fixtures')
    calls = join(root, 'gh.calls')

    for (const path of [cwd, fixtures, join(root, 'bin'), join(root, 'home')]) {
        mkdirSync(path, { recursive: true })
    }

    for (const utility of [
        'sh',
        'dash',
        'mkdir',
        'rm',
        'mv',
        'cat',
        'sed',
        'grep',
        'hostname',
        'mktemp',
        'chmod',
        'sleep',
        'tr',
        'sha256sum',
        'cmp',
        'shasum',
    ]) {
        const located = spawnSync('sh', ['-c', `command -v ${utility}`], { encoding: 'utf8' })

        if (located.status === 0) {
            symlinkSync(located.stdout.trim(), join(root, 'bin', utility))
        }
    }

    executable(join(root, 'bin', 'gh'), fakeGh)
    executable(
        join(root, 'bin', 'uname'),
        `#!/bin/sh
case $1 in
    -s) echo "\${FAKE_OS:-Linux}" ;;
    -m) echo "\${FAKE_ARCH:-x86_64}" ;;
esac
`,
    )
    writeFileSync(join(fixtures, `ft-${target}`), runner)
    writeFileSync(join(fixtures, 'ft-shim'), readFileSync(shim))
    writeFileSync(join(fixtures, 'schema.json'), '{}\n')
    writeFileSync(
        join(fixtures, 'SHA256SUMS'),
        `${digest(runner)}  ft-${target}\n${digest(readFileSync(shim, 'utf8'))}  ft-shim\n${digest('{}\n')}  schema.json\n`,
    )
    env = {
        ...process.env,
        PATH: join(root, 'bin'),
        HOME: join(root, 'home'),
        GH_TOKEN: undefined,
        GITHUB_TOKEN: undefined,
        FT_GH_FALLBACK_DIRS: join(root, 'no-gh'),
        TMPDIR: root,
        XDG_CACHE_HOME: cache,
        FT_INSTALL_DIR: join(root, 'install with spaces'),
        SHELL: '/bin/bash',
        FT_CONFIG: '/must-not-leak-to-bootstrap',
        FAKE_FIXTURES: fixtures,
        FAKE_CALLS: calls,
    }
})

afterEach(() => {
    rmSync(root, { recursive: true, force: true })
})

describe.each(shells)('shim via %s', shell => {
    it('installs, hands off exact argv/config, then uses cache without gh', async () => {
        configure()

        const first = await start(shell, ['run', 'two words', '*', '']).result

        expect(first.code).toBe(0)
        expect(first.stdout).toBe(
            `runner=0.1.0\nFT_CONFIG=${join(project, '.ft.json')}\nPATH=${env.PATH}\narg=<run>\narg=<two words>\narg=<*>\narg=<>\n`,
        )
        expect(ghCalls()).toEqual([
            expect.stringContaining(
                `release download v${version} -R superbuilders/ft -p ft-${target} -D ${cache}/ft/staging/`,
            ),
        ])
        expect(existsSync(finalPath())).toBe(true)
        expectClean()

        const second = await start(shell, ['doctor'], { FAKE_GH_FAIL: 'download' }).result

        expect(second.code).toBe(0)
        expect(second.stdout).toContain('arg=<doctor>')
        expect(ghCalls()).toHaveLength(1)
        expectClean()
    })

    it('bootstraps with the first executable fallback gh when gh is not on PATH', async () => {
        rmSync(join(root, 'bin', 'gh'))

        const nonExecutable = join(root, 'non-executable')
        const fallback = join(root, 'fallback with spaces')
        const laterFallback = join(root, 'later fallback')

        for (const directory of [nonExecutable, fallback, laterFallback]) {
            mkdirSync(directory)
        }

        writeFileSync(join(nonExecutable, 'gh'), fakeGh, { mode: 0o644 })
        executable(join(fallback, 'gh'), fakeGh)
        executable(join(laterFallback, 'gh'), '#!/bin/sh\nexit 9\n')

        const result = await start(shell, ['pin', version], {
            FT_GH_FALLBACK_DIRS: [
                join(root, 'missing'),
                nonExecutable,
                fallback,
                laterFallback,
            ].join(':'),
        }).result

        expect(result.code, result.stderr).toBe(0)
        expect(result.stdout).toContain('arg=<pin>')
        expect(result.stdout).toContain(`PATH=${fallback}:`)
        expect(ghCalls()).toEqual([
            'release view -R superbuilders/ft --json tagName',
            expect.stringContaining('-p SHA256SUMS -D '),
            expect.stringContaining(`-p ft-${target} -D `),
        ])
        expect(existsSync(finalPath())).toBe(true)
        expectClean()
    })

    it('prefers gh on PATH over fallback directories', async () => {
        configure()

        const fallback = join(root, 'fallback')

        mkdirSync(fallback)
        executable(join(fallback, 'gh'), '#!/bin/sh\nexit 9\n')

        const result = await start(shell, ['run'], { FT_GH_FALLBACK_DIRS: fallback }).result

        expect(result.code, result.stderr).toBe(0)
        expect(ghCalls()).toHaveLength(1)
        expectClean()
    })

    it('fails checksum verification without publishing or retaining a lock', async () => {
        configure({ [target]: '0'.repeat(64) })

        const result = await start(shell, ['run']).result

        expect(result.code).toBe(1)
        expect(result.stderr).toContain('checksum mismatch')
        expect(existsSync(finalPath())).toBe(false)
        expectClean()
    })

    it('reports a missing target hash before downloading', async () => {
        configure({ 'darwin-arm64': digest(runner) })

        const result = await start(shell, ['run']).result

        expect(result.code).toBe(2)
        expect(result.stderr).toContain(`missing hash for target ${target}`)
        expect(ghCalls()).toEqual([])
    })

    it('six concurrent cold starts download once and all exec', async () => {
        configure()

        const results = await Promise.all(
            Array.from(
                { length: 6 },
                (_, index) => start(shell, ['run', String(index)], { FAKE_DELAY: '0.3' }).result,
            ),
        )

        for (const [index, result] of results.entries()) {
            expect(result.code, result.stderr).toBe(0)
            expect(result.stdout).toContain(`arg=<${index}>`)
        }

        expect(ghCalls()).toHaveLength(1)
        expectClean()
    })

    it('recovers a lock held by a dead pid on this host', async () => {
        configure()

        const dead = spawnSync('sh', ['-c', ':'])
        const lock = join(cache, 'ft', 'locks', `runner-${version}.lock`)

        expect(dead.pid).toBeGreaterThan(0)
        mkdirSync(lock, { recursive: true })
        writeFileSync(join(lock, 'owner'), `${dead.pid} ${hostname()}\n`)

        const result = await start(shell, ['doctor']).result

        expect(result.code).toBe(0)
        expect(ghCalls()).toHaveLength(1)
        expectClean()
    })

    it('bootstraps pin using the latest runner and release SHA256SUMS', async () => {
        const result = await start(shell, ['pin', '0.2.0']).result

        expect(result.code, result.stderr).toBe(0)
        expect(result.stdout).toContain('FT_CONFIG=unset')
        expect(result.stdout).toContain('arg=<pin>\narg=<0.2.0>')
        expect(ghCalls()).toEqual([
            'release view -R superbuilders/ft --json tagName',
            expect.stringContaining('-p SHA256SUMS -D '),
            expect.stringContaining(`-p ft-${target} -D `),
        ])
        expect(existsSync(finalPath())).toBe(true)
        expectClean()
    })

    it('bootstraps init using the latest runner', async () => {
        const result = await start(shell, ['init', '--user']).result

        expect(result.code, result.stderr).toBe(0)
        expect(result.stdout).toContain('arg=<init>\narg=<--user>')
        expect(ghCalls()[0]).toBe('release view -R superbuilders/ft --json tagName')
    })

    it('uses the personal config where the directory has none', async () => {
        const personal = join(root, 'xdg', 'ft')

        configure(undefined, personal)

        const result = await start(shell, ['doctor'], { XDG_CONFIG_HOME: join(root, 'xdg') }).result

        expect(result.code, result.stderr).toBe(0)
        expect(result.stdout).toContain(`FT_CONFIG=${join(personal, '.ft.json')}`)
    })

    it('asks for ft init when no config exists', async () => {
        const result = await start(shell, ['doctor']).result

        expect(result.code).toBe(2)
        expect(result.stderr).toContain(
            'no .ft.json here or above, and no personal config; set ft up with ft init',
        )
        expect(ghCalls()).toEqual([])
    })

    it('requires pin when the config has no lock beside it', async () => {
        writeFileSync(join(project, '.ft.json'), '{}')

        const result = await start(shell, ['doctor']).result

        expect(result.code).toBe(2)
        expect(result.stderr).toContain(`no ${join(project, '.ft/lock.json')} found`)
        expect(ghCalls()).toEqual([])
    })

    it('prints the shim version without config or gh', async () => {
        rmSync(join(root, 'bin', 'gh'))

        const result = await start(shell, ['--shim-version']).result

        expect(result).toEqual({ code: 0, stdout: '0.1.0\n', stderr: '' })
    })

    it.each(['FreeBSD', 'Windows'])('rejects unsupported OS %s', async os => {
        configure()

        const result = await start(shell, ['run'], { FAKE_OS: os }).result

        expect(result.code).toBe(2)
        expect(result.stderr).toContain('unsupported platform')
        expect(ghCalls()).toEqual([])
    })

    it.each([
        ['Linux', 'amd64', 'linux-x64'],
        ['Linux', 'aarch64', 'linux-arm64'],
        ['Darwin', 'arm64', 'darwin-arm64'],
        ['Darwin', 'x86_64', 'darwin-x64'],
    ])('maps %s/%s to %s', async (os, arch, mapped) => {
        configure({ [mapped]: digest(runner) })
        writeFileSync(join(fixtures, `ft-${mapped}`), runner)

        const result = await start(shell, ['doctor'], { FAKE_OS: os, FAKE_ARCH: arch }).result

        expect(result.code, result.stderr).toBe(0)
        expect(ghCalls()[0]).toContain(`-p ft-${mapped} -D `)
    })

    it('uses shasum when sha256sum is unavailable', async () => {
        if (!existsSync(join(root, 'bin', 'shasum'))) {
            return
        }

        configure()
        rmSync(join(root, 'bin', 'sha256sum'))

        const result = await start(shell, ['doctor']).result

        expect(result.code, result.stderr).toBe(0)
    })

    it('rejects unsafe version paths before cache access', async () => {
        configure()
        writeFileSync(
            join(project, '.ft/lock.json'),
            JSON.stringify(
                { version: '../outside', sha256: { [target]: digest(runner) } },
                null,
                4,
            ),
        )

        const result = await start(shell, ['doctor']).result

        expect(result.code).toBe(2)
        expect(result.stderr).toContain('invalid or missing runner version')
        expect(ghCalls()).toEqual([])
    })

    it('does not publish a bootstrap runner when the release checksum mismatches', async () => {
        writeFileSync(join(fixtures, 'SHA256SUMS'), `${'0'.repeat(64)}  ft-${target}\n`)

        const result = await start(shell, ['pin', version]).result

        expect(result.code).toBe(1)
        expect(result.stderr).toContain('checksum mismatch')
        expect(existsSync(finalPath())).toBe(false)
        expectClean()
    })

    it('rejects an unsupported architecture', async () => {
        configure()

        const result = await start(shell, ['run'], { FAKE_ARCH: 'riscv64' }).result

        expect(result.code).toBe(2)
        expect(result.stderr).toContain('unsupported platform architecture')
    })

    it.each(['auth', 'download'])('reports gh failure %s and cleans up', async failure => {
        configure()

        const result = await start(shell, ['run'], { FAKE_GH_FAIL: failure }).result

        expect(result.code).toBe(failure === 'auth' ? 2 : 1)
        expect(result.stderr).toContain(
            failure === 'auth' ? 'gh is not authenticated' : 'download or lookup failed',
        )
        expectClean()
    })

    it.each([
        { os: 'Darwin', overrides: {}, locked: true },
        { os: 'Linux', overrides: {}, locked: false },
        { os: 'Darwin', overrides: { GH_TOKEN: 'fake-env-token' }, locked: false },
        { os: 'Darwin', overrides: { GITHUB_TOKEN: 'fake-env-token' }, locked: false },
        { os: 'Darwin', overrides: { GH_TOKEN: '' }, locked: false },
        { os: 'Darwin', overrides: { GITHUB_TOKEN: '' }, locked: false },
        { os: 'Darwin', overrides: { FAKE_AUTH_TOKEN_EXIT: '0' }, locked: false },
    ])('diagnoses unauthenticated gh without exposing tokens: %j', async scenario => {
        const mapped = scenario.os === 'Darwin' ? 'darwin-x64' : target
        const fallback = join(root, 'fallback with spaces')

        configure({ [mapped]: digest(runner) })
        rmSync(join(root, 'bin', 'gh'))
        mkdirSync(fallback)
        executable(join(fallback, 'gh'), fakeGh)

        const result = await start(shell, ['run'], {
            FAKE_OS: scenario.os,
            FAKE_GH_FAIL: 'keychain',
            FT_GH_FALLBACK_DIRS: fallback,
            ...scenario.overrides,
        }).result

        expect(result.code).toBe(2)
        expect(result.stdout).toBe('')
        expect(result.stderr).toBe(
            scenario.locked
                ? 'ft: gh cannot read its token (on macOS this usually means the login keychain is locked in this session, such as over SSH); set GH_TOKEN or run security unlock-keychain\n'
                : 'ft: gh is not authenticated; run gh auth login\n',
        )
        expect(ghCalls()).toEqual([expect.stringContaining(`-p ft-${mapped} -D `), 'auth token'])
        expect(existsSync(finalPath())).toBe(false)
        expectClean()
    })

    it('reports a missing gh', async () => {
        configure()
        rmSync(join(root, 'bin', 'gh'))

        const result = await start(shell, ['run']).result

        expect(result.code).toBe(2)
        expect(result.stderr).toContain('gh is required')
        expectClean()
    })

    it.each([{ FAKE_SMOKE_VERSION: '0.9.0' }, { FAKE_SMOKE_EXIT: '1' }])(
        'rejects failed runner smoke test %j',
        async overrides => {
            configure()

            const result = await start(shell, ['run'], overrides).result

            expect(result.code).toBe(1)
            expect(result.stderr).toContain('runner smoke test failed')
            expect(existsSync(finalPath())).toBe(false)
            expectClean()
        },
    )

    it.each(['SIGINT', 'SIGTERM'] as const)('cleans staging and lock on %s', async signal => {
        configure()

        const { child, result } = start(shell, ['run'], { FAKE_BLOCK: 'yes' })

        await waitFor(() => ghCalls().length === 1)
        child.kill(signal)

        const finished = await result

        expect(finished.code).toBe(signal === 'SIGINT' ? 130 : 143)
        expect(existsSync(finalPath())).toBe(false)
        expectClean()
    })

    it.each(['missing owner', 'live pid', 'another host'])(
        'waits for a lock with %s without stealing it',
        async holder => {
            configure()

            const lock = join(cache, 'ft', 'locks', `runner-${version}.lock`)

            mkdirSync(lock, { recursive: true })

            if (holder !== 'missing owner') {
                writeFileSync(
                    join(lock, 'owner'),
                    `${process.pid} ${holder === 'live pid' ? hostname() : 'another-host'}\n`,
                )
            }

            const { child, result } = start(shell, ['run'])

            await new Promise(resolveWait => setTimeout(resolveWait, 300))
            expect(ghCalls()).toEqual([])
            child.kill('SIGTERM')

            const finished = await result

            expect(finished.code).toBe(143)
            expect(finished.stderr.match(/waiting for/g)).toHaveLength(1)
            expect(existsSync(lock)).toBe(true)
        },
    )
})

describe('installer via sh', () => {
    it('installs verified latest shim atomically and prints a usable PATH line', async () => {
        const result = await start('sh', [], {}, installer).result
        const installed = join(env.FT_INSTALL_DIR ?? '', 'ft')

        expect(result.code, result.stderr).toBe(0)
        expect(readFileSync(installed, 'utf8')).toBe(readFileSync(shim, 'utf8'))
        expect(result.stdout).toContain(`  export PATH='${env.FT_INSTALL_DIR}':"$PATH"`)
        expect(result.stdout).toMatch(/Setting up your personal config\.\.\. +done/)
        expect(result.stdout).not.toContain('arg=<init>')
        expect(result.stdout).toContain('  https://github.com/superbuilders/ft#readme\n')
        expect(ghCalls()).toEqual([
            'auth status',
            'release view -R superbuilders/ft --json tagName',
            expect.stringContaining(
                `release download v0.1.0 -R superbuilders/ft -p ft-shim -p SHA256SUMS -p ft-${target} -p schema.json -D `,
            ),
        ])
        expect(readFileSync(join(cache, 'ft/runner/0.1.0/ft'), 'utf8')).toBe(runner)

        const rerun = await start(
            'sh',
            ['v0.1.0'],
            { PATH: `${env.PATH}:${env.FT_INSTALL_DIR}` },
            installer,
        ).result

        expect(rerun.code).toBe(0)
        expect(rerun.stdout).toMatch(/Installing to .+\.\.\. +unchanged/)
        expect(rerun.stdout).not.toContain('export PATH=')
        expect(readdirSync(env.FT_INSTALL_DIR ?? '')).toEqual(['ft'])
    })

    it('quotes apostrophes in the suggested PATH line', async () => {
        const destination = join(root, "user's bin")
        const result = await start('sh', [version], { FT_INSTALL_DIR: destination }, installer)
            .result
        const line = result.stdout
            .split('\n')
            .map(text => text.trim())
            .find(text => text.startsWith('export PATH='))

        expect(result.code, result.stderr).toBe(0)
        expect(line).toBeDefined()

        const evaluated = spawnSync('sh', ['-c', `${line}\nprintf '%s' "$PATH"`], {
            env,
            encoding: 'utf8',
        })

        expect(evaluated.status).toBe(0)
        expect(evaluated.stdout).toBe(`${destination}:${env.PATH}`)
    })

    it.each(['SIGINT', 'SIGTERM'] as const)(
        'cleans installer staging on %s during a blocked download',
        async signal => {
            const { child, result } = start('sh', [version], { FAKE_BLOCK: 'yes' }, installer)

            await waitFor(() => ghCalls().some(call => call.startsWith('release download')))
            child.kill(signal)

            const finished = await result

            expect(finished.code).toBe(signal === 'SIGINT' ? 130 : 143)
            expect(existsSync(env.FT_INSTALL_DIR ?? '')).toBe(false)
            expect(readdirSync(root).filter(name => name.startsWith('ft-install.'))).toEqual([])
        },
    )

    it('rejects a bad checksum and preserves a previously installed shim', async () => {
        const installedDir = env.FT_INSTALL_DIR ?? ''

        mkdirSync(installedDir)
        writeFileSync(join(installedDir, 'ft'), 'old shim')
        writeFileSync(join(fixtures, 'ft-shim'), 'tampered')

        const result = await start('sh', ['0.1.0'], {}, installer).result

        expect(result.code).toBe(1)
        expect(result.stderr).toContain('checksum mismatch')
        expect(readFileSync(join(installedDir, 'ft'), 'utf8')).toBe('old shim')
    })
})
