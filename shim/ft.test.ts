import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
    chmodSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    realpathSync,
    rmSync,
    symlinkSync,
    utimesSync,
    writeFileSync,
} from 'node:fs'
import { hostname, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { releaseServer } from './tests/fakes/release-server'

import type { ReleaseServer } from './tests/fakes/release-server'

const shim = resolve('shim/ft')
const installer = resolve('install.sh')
const version = '0.1.0'
const target = 'linux-x64'
const runner = `#!/bin/sh
if [ "\${1:-}" = --version ]; then
    printf '%s\\n' "\${FAKE_SMOKE_VERSION:-0.1.0}"
    exit "\${FAKE_SMOKE_EXIT:-0}"
fi
printf 'runner=0.1.0\\nFT_CONFIG=%s\\n' "\${FT_CONFIG:-unset}"
printf 'PATH=%s\\n' "$PATH"
printf 'arg=<%s>\\n' "$@"
`

/** The host's copies of the tools the launcher may call, looked up once for every test's PATH. */
const hostTools = [
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
    'find',
    'tr',
    'sha256sum',
    'cmp',
    'shasum',
    'curl',
].flatMap(utility => {
    const located = spawnSync('sh', ['-c', `command -v ${utility}`], { encoding: 'utf8' })

    return located.status === 0 ? [[utility, located.stdout.trim()] as const] : []
})

const shPath = hostTools.find(([utility]) => utility === 'sh')?.[1]
const dashPath = hostTools.find(([utility]) => utility === 'dash')?.[1]
const shells = ['sh']

if (shPath && dashPath && realpathSync(shPath) !== realpathSync(dashPath)) {
    shells.push('dash')
}

let root: string
let project: string
let cwd: string
let cache: string
let fixtures: string
let calls: string
let env: NodeJS.ProcessEnv
let server: ReleaseServer

/**
 * Hash a release fixture.
 * @param content - asset contents
 * @returns its SHA-256 checksum
 */
function digest(content: string) {
    return createHash('sha256').update(content).digest('hex')
}

/**
 * Write an executable fixture.
 * @param path - executable path
 * @param content - executable contents
 */
function executable(path: string, content: string) {
    writeFileSync(path, content)
    chmodSync(path, 0o755)
}

/**
 * Set up a scope with a pinned runner.
 * @param hashes - checksums by platform target
 * @param directory - scope's configuration directory
 */
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

/**
 * Read release requests, excluding the redirect hops.
 * @returns requested release paths
 */
function releaseCalls() {
    return existsSync(calls)
        ? readFileSync(calls, 'utf8')
              .trim()
              .split('\n')
              .filter(path => !path.startsWith('/storage/') && !path.startsWith('/tag/'))
        : []
}

/**
 * Launch a shell script and collect its output.
 * @param shell - shell to execute
 * @param args - arguments passed unchanged to the script
 * @param overrides - test-specific environment overrides
 * @param script - launcher or installer path
 * @returns child process and its eventual result
 */
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

/**
 * Wait for an observable launcher state.
 * @param predicate - whether the expected state has been reached
 * @returns completion once the state is reached
 */
async function waitFor(predicate: () => boolean) {
    for (let attempt = 0; attempt < 200; attempt += 1) {
        if (predicate()) {
            return
        }

        await new Promise(resolveWait => setTimeout(resolveWait, 10))
    }

    throw new Error('Timed out waiting for shim state')
}

/**
 * Locate the cached runner for the default fixture.
 * @returns published runner path
 */
function finalPath() {
    return join(cache, 'ft', 'runner', version, digest(runner), 'ft')
}

/** Assert that the launcher has removed its locks and staging directories. */
function expectClean() {
    for (const directory of ['locks', 'staging']) {
        const path = join(cache, 'ft', directory)

        expect(existsSync(path) ? readdirSync(path) : []).toEqual([])
    }
}

beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'ft-shim-test-'))
    project = join(root, 'project with spaces')
    cwd = join(project, 'nested', 'deep')
    cache = join(root, 'cache')
    fixtures = join(root, 'fixtures')
    calls = join(root, 'release.calls')

    for (const path of [cwd, fixtures, join(root, 'bin'), join(root, 'home')]) {
        mkdirSync(path, { recursive: true })
    }

    for (const [utility, path] of hostTools) {
        symlinkSync(path, join(root, 'bin', utility))
    }

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
    server = await releaseServer({ fixtures, version, calls })
    env = {
        ...process.env,
        PATH: join(root, 'bin'),
        HOME: join(root, 'home'),
        FT_RELEASE_URL: server.url,
        FT_NPM_PACKAGE: undefined,
        TMPDIR: root,
        XDG_CACHE_HOME: cache,
        FT_INSTALL_DIR: join(root, 'install with spaces'),
        SHELL: '/bin/bash',
        FT_CONFIG: '/must-not-leak-to-bootstrap',
    }
})

afterEach(async () => {
    await server.close()
    rmSync(root, { recursive: true, force: true })
})

describe.each(shells)('shim via %s', shell => {
    it('installs, hands off exact argv/config, then uses cache without curl', async () => {
        configure()

        const first = await start(shell, ['run', 'two words', '*', '']).result

        expect(first.code).toBe(0)
        expect(first.stdout).toBe(
            `runner=0.1.0\nFT_CONFIG=${join(project, '.ft.json')}\nPATH=${env.PATH}\narg=<run>\narg=<two words>\narg=<*>\narg=<>\n`,
        )
        expect(releaseCalls()).toEqual([`/download/v${version}/ft-${target}`])
        expect(existsSync(finalPath())).toBe(true)
        expectClean()

        rmSync(join(root, 'bin', 'curl'))
        server.controls.fail = 404

        const second = await start(shell, ['doctor'], {
            HOME: undefined,
            XDG_CONFIG_HOME: undefined,
        }).result

        expect(second.code, second.stderr).toBe(0)
        expect(second.stdout).toContain('arg=<doctor>')
        expect(releaseCalls()).toHaveLength(1)
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
        expect(releaseCalls()).toEqual([])
    })

    it('six concurrent cold starts download once and all exec', async () => {
        configure()
        server.controls.delayMs = 300

        const results = await Promise.all(
            Array.from({ length: 6 }, (_, index) => start(shell, ['run', String(index)]).result),
        )

        for (const [index, result] of results.entries()) {
            expect(result.code, result.stderr).toBe(0)
            expect(result.stdout).toContain(`arg=<${index}>`)
        }

        expect(releaseCalls()).toHaveLength(1)
        expectClean()
    })

    it('recovers a lock left without an owner for over a minute', async () => {
        configure()

        const lock = join(cache, 'ft', 'locks', `runner-${version}.lock`)
        const old = new Date(Date.now() - 5 * 60 * 1000)

        mkdirSync(lock, { recursive: true })
        utimesSync(lock, old, old)

        const result = await start(shell, ['doctor']).result

        expect(result.code, result.stderr).toBe(0)
        expect(releaseCalls()).toHaveLength(1)
        expectClean()
    })

    it('downloads the pinned build when another build of the same version is cached', async () => {
        configure()

        const other = join(cache, 'ft', 'runner', version, '0'.repeat(64), 'ft')

        mkdirSync(join(other, '..'), { recursive: true })
        writeFileSync(other, '#!/bin/sh\necho other build\n', { mode: 0o755 })

        const result = await start(shell, ['doctor']).result

        expect(result.code, result.stderr).toBe(0)
        expect(result.stdout).not.toContain('other build')
        expect(releaseCalls()).toHaveLength(1)
        expect(readFileSync(finalPath(), 'utf8')).toBe(runner)
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
        expect(releaseCalls()).toHaveLength(1)
        expectClean()
    })

    it('bootstraps pin using the latest runner and release SHA256SUMS', async () => {
        const result = await start(shell, ['pin', '0.2.0']).result

        expect(result.code, result.stderr).toBe(0)
        expect(result.stdout).toContain('FT_CONFIG=unset')
        expect(result.stdout).toContain('arg=<pin>\narg=<0.2.0>')
        expect(releaseCalls()).toEqual([
            '/latest',
            `/download/v${version}/SHA256SUMS`,
            `/download/v${version}/ft-${target}`,
        ])
        expect(existsSync(finalPath())).toBe(true)
        expectClean()
    })

    it('bootstraps init using the latest runner', async () => {
        const result = await start(shell, ['init', '--user']).result

        expect(result.code, result.stderr).toBe(0)
        expect(result.stdout).toContain('arg=<init>\narg=<--user>')
        expect(releaseCalls()[0]).toBe('/latest')
    })

    it('bootstraps npm init with bun without requesting a release', async () => {
        const npmPackage = join(root, 'npm package')

        mkdirSync(join(npmPackage, 'src'), { recursive: true })
        writeFileSync(join(npmPackage, 'src', 'cli.ts'), '// npm entrypoint fixture\n')
        executable(
            join(root, 'bin', 'bun'),
            `#!/bin/sh\nprintf 'bun\\nFT_CONFIG=%s\\n' "\${FT_CONFIG:-unset}"\nprintf 'arg=<%s>\\n' "$@"\n`,
        )

        const result = await start(shell, ['init', '--user'], {
            FT_NPM_PACKAGE: npmPackage,
        }).result

        expect(result).toEqual({
            code: 0,
            stdout: `bun\nFT_CONFIG=unset\narg=<${join(npmPackage, 'src', 'cli.ts')}>\narg=<init>\narg=<--user>\n`,
            stderr: '',
        })
        expect(releaseCalls()).toEqual([])
        expect(existsSync(finalPath())).toBe(false)
        expectClean()
    })

    it('uses the personal pin instead of npm bun when both are present', async () => {
        const npmPackage = join(root, 'npm package')
        const config = join(root, 'xdg')
        const personal = join(config, 'ft')

        configure(undefined, personal)
        mkdirSync(join(npmPackage, 'src'), { recursive: true })
        writeFileSync(join(npmPackage, 'src', 'cli.ts'), '// npm entrypoint fixture\n')
        executable(join(root, 'bin', 'bun'), '#!/bin/sh\nprintf \'bun\\narg=<%s>\\n\' "$@"\n')

        const result = await start(shell, ['init', '--user'], {
            FT_NPM_PACKAGE: npmPackage,
            XDG_CONFIG_HOME: config,
        }).result

        expect(result.code, result.stderr).toBe(0)
        expect(result.stdout).toContain('runner=0.1.0\n')
        expect(result.stdout).toContain(`FT_CONFIG=${join(personal, '.ft.json')}`)
        expect(result.stdout).toContain('arg=<init>\narg=<--user>')
        expect(result.stdout).not.toContain('bun\n')
        expect(releaseCalls()).toEqual([`/download/v${version}/ft-${target}`])
        expectClean()
    })

    it.each([[['--version']], [['guide']]])(
        'runs npm bun for %o where no config exists',
        async args => {
            const npmPackage = join(root, 'npm package')

            mkdirSync(join(npmPackage, 'src'), { recursive: true })
            writeFileSync(join(npmPackage, 'src', 'cli.ts'), '// npm entrypoint fixture\n')
            executable(
                join(root, 'bin', 'bun'),
                '#!/bin/sh\necho bun\nprintf \'arg=<%s>\\n\' "$@"\n',
            )

            const result = await start(shell, args, { FT_NPM_PACKAGE: npmPackage }).result

            expect(result.code, result.stderr).toBe(0)
            expect(result.stdout).toBe(
                `bun\narg=<${join(npmPackage, 'src', 'cli.ts')}>\n${args.map(arg => `arg=<${arg}>\n`).join('')}`,
            )
            expect(releaseCalls()).toEqual([])
        },
    )

    it.each([[['upgrade']], [['uninstall']]])(
        'runs npm bun for %o even with a personal pin',
        async args => {
            const npmPackage = join(root, 'npm package')
            const config = join(root, 'xdg')

            configure(undefined, join(config, 'ft'))
            mkdirSync(join(npmPackage, 'src'), { recursive: true })
            writeFileSync(join(npmPackage, 'src', 'cli.ts'), '// npm entrypoint fixture\n')
            executable(join(root, 'bin', 'bun'), '#!/bin/sh\nprintf \'bun\\narg=<%s>\\n\' "$@"\n')

            const result = await start(shell, args, {
                FT_NPM_PACKAGE: npmPackage,
                XDG_CONFIG_HOME: config,
            }).result

            expect(result.code, result.stderr).toBe(0)
            expect(result.stdout).toContain('bun\n')
            expect(result.stdout).not.toContain('runner=0.1.0')
            expect(releaseCalls()).toEqual([])
        },
    )

    it('uses the personal config where the directory has none', async () => {
        const personal = join(root, 'xdg', 'ft')

        configure(undefined, personal)

        const result = await start(shell, ['doctor'], { XDG_CONFIG_HOME: join(root, 'xdg') }).result

        expect(result.code, result.stderr).toBe(0)
        expect(result.stdout).toContain(`FT_CONFIG=${join(personal, '.ft.json')}`)
    })

    it.each([[['skill', '--user']], [['doctor', '--user']], [['uninstall']]])(
        'uses the personal setup for %o, even inside a repository',
        async args => {
            const personal = join(root, 'xdg', 'ft')

            configure()
            configure(undefined, personal)

            const result = await start(shell, args, { XDG_CONFIG_HOME: join(root, 'xdg') }).result

            expect(result.code, result.stderr).toBe(0)
            expect(result.stdout).toContain(`FT_CONFIG=${join(personal, '.ft.json')}`)
        },
    )

    it('asks for a personal setup when --user has none, despite a repository config', async () => {
        configure()

        const result = await start(shell, ['skill', '--user'], {
            XDG_CONFIG_HOME: join(root, 'xdg'),
        }).result

        expect(result.code).toBe(2)
        expect(result.stderr).toContain('no personal config (set it up with ft init --user)')
        expect(releaseCalls()).toEqual([])
    })

    it('asks for ft init when no config exists', async () => {
        const result = await start(shell, ['doctor']).result

        expect(result.code).toBe(2)
        expect(result.stderr).toContain(
            'no .ft.json here or above, and no personal config (set ft up with ft init',
        )
        expect(releaseCalls()).toEqual([])
    })

    it('names HOME, not a shell error, when HOME is unset too', async () => {
        const result = await start(shell, ['doctor'], {
            HOME: undefined,
            XDG_CONFIG_HOME: undefined,
        }).result

        expect(result.code).toBe(2)
        expect(result.stderr).toContain('HOME is not set (set it, or set XDG_CONFIG_HOME')
    })

    it('requires pin when the config has no lock beside it', async () => {
        writeFileSync(join(project, '.ft.json'), '{}')

        const result = await start(shell, ['doctor']).result

        expect(result.code).toBe(2)
        expect(result.stderr).toContain(`no ${join(project, '.ft/lock.json')} (run ft pin)`)
        expect(releaseCalls()).toEqual([])
    })

    it('asks for a personal pin when the personal config has no lock', async () => {
        const config = join(root, 'xdg')

        mkdirSync(join(config, 'ft'), { recursive: true })
        writeFileSync(join(config, 'ft', '.ft.json'), '{}')

        cwd = root

        const result = await start(shell, ['doctor'], { XDG_CONFIG_HOME: config }).result

        expect(result.code).toBe(2)
        expect(result.stderr).toContain('lock.json (run ft pin --user)')
    })

    it('prints the shim version without config or curl', async () => {
        rmSync(join(root, 'bin', 'curl'))

        const result = await start(shell, ['--shim-version']).result

        expect(result).toEqual({ code: 0, stdout: '0.2.0\n', stderr: '' })
        expect(releaseCalls()).toEqual([])
    })

    it.each(['FreeBSD', 'Windows'])('rejects unsupported OS %s', async os => {
        configure()

        const result = await start(shell, ['run'], { FAKE_OS: os }).result

        expect(result.code).toBe(2)
        expect(result.stderr).toContain('unsupported platform')
        expect(releaseCalls()).toEqual([])
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
        expect(releaseCalls()).toEqual([`/download/v${version}/ft-${mapped}`])
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
        expect(releaseCalls()).toEqual([])
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

    it('reports a failed download with its URL and cleans up', async () => {
        configure()
        server.controls.fail = 404

        const result = await start(shell, ['run']).result

        expect(result.code).toBe(1)
        expect(result.stderr).toContain(
            `cannot download ${server.url}/download/v${version}/ft-${target}`,
        )
        expect(result.stderr).toContain('(The requested URL returned error: 404)')
        expect(existsSync(finalPath())).toBe(false)
        expectClean()
    })

    it('reports a missing curl when a download is needed', async () => {
        configure()
        rmSync(join(root, 'bin', 'curl'))

        const result = await start(shell, ['run']).result

        expect(result.code).toBe(2)
        expect(result.stderr).toContain('curl is required to download ft releases')
        expect(releaseCalls()).toEqual([])
        expectClean()
    })

    it.each([{ FAKE_SMOKE_VERSION: '0.9.0' }, { FAKE_SMOKE_EXIT: '1' }])(
        'rejects failed runner smoke test %j',
        async overrides => {
            configure()

            const result = await start(shell, ['run'], overrides).result

            expect(result.code).toBe(1)
            expect(result.stderr).toContain('runner version check failed')
            expect(existsSync(finalPath())).toBe(false)
            expectClean()
        },
    )

    it.each(['SIGINT', 'SIGTERM'] as const)('cleans staging and lock on %s', async signal => {
        configure()

        server.controls.block = true

        const { child, result } = start(shell, ['run'])

        await waitFor(() => server.requests.includes(`/storage/v${version}/ft-${target}`))
        child.kill(signal)

        const finished = await result

        expect(finished.code).toBe(signal === 'SIGINT' ? 130 : 143)
        expect(existsSync(finalPath())).toBe(false)
        expectClean()
    })

    it('stops a bootstrap while curl is still downloading release metadata', async () => {
        server.controls.block = true

        const { child, result } = start(shell, ['pin', '0.2.0'])

        await waitFor(() => server.requests.includes(`/storage/v${version}/SHA256SUMS`))
        child.kill('SIGTERM')

        const finished = await result

        expect(finished.code).toBe(143)
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
            expect(releaseCalls()).toEqual([])
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
        expect(releaseCalls()).toEqual([
            '/latest',
            `/download/v${version}/ft-shim`,
            `/download/v${version}/SHA256SUMS`,
            `/download/v${version}/ft-${target}`,
            `/download/v${version}/schema.json`,
        ])
        expect(readFileSync(finalPath(), 'utf8')).toBe(runner)

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

    it('moves an existing personal pin to the installed version, and only when it differs', async () => {
        const config = { XDG_CONFIG_HOME: join(root, 'config') }
        const personal = join(config.XDG_CONFIG_HOME, 'ft')

        mkdirSync(join(personal, '.ft'), { recursive: true })
        writeFileSync(join(personal, '.ft.json'), '{}\n')
        writeFileSync(join(personal, '.ft', 'lock.json'), '{\n    "version": "0.0.9"\n}\n')

        const moved = await start('sh', [version], config, installer).result

        expect(moved.code, moved.stderr).toBe(0)
        expect(moved.stdout).toMatch(/Updating your personal config\.\.\. +done/)
        expect(moved.stdout).not.toContain('Setting up')

        writeFileSync(join(personal, '.ft', 'lock.json'), `{\n    "version": "${version}"\n}\n`)

        const current = await start('sh', [version], config, installer).result

        expect(current.code, current.stderr).toBe(0)
        expect(current.stdout).not.toContain('Updating your personal config')
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
            server.controls.block = true

            const { child, result } = start('sh', [version], {}, installer)

            await waitFor(() => server.requests.includes(`/storage/v${version}/ft-shim`))
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
