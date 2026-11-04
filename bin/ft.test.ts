import { spawnSync } from 'node:child_process'
import {
    chmodSync,
    copyFileSync,
    mkdirSync,
    mkdtempSync,
    realpathSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, beforeEach, expect, it } from 'vitest'

let root: string
let installed: string

/**
 * Write an executable file.
 * @param path - destination
 * @param content - its text
 * @returns nothing
 */
function executable(path: string, content: string): void {
    writeFileSync(path, content)
    chmodSync(path, 0o755)
}

beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'ft-npm-bin-')))
    installed = join(root, 'lib', 'node_modules', '@superbuilders', 'ft')

    for (const directory of ['bin', 'shim', 'src']) {
        mkdirSync(join(installed, directory), { recursive: true })
    }

    copyFileSync(resolve('bin/ft'), join(installed, 'bin/ft'))
    copyFileSync(resolve('shim/ft'), join(installed, 'shim/ft'))
    chmodSync(join(installed, 'bin/ft'), 0o755)
    writeFileSync(join(installed, 'src/cli.ts'), '')

    /* npm links the bin with a relative path from its own bin folder. */
    mkdirSync(join(root, 'bin'))
    symlinkSync('../lib/node_modules/@superbuilders/ft/bin/ft', join(root, 'bin', 'ft'))
    mkdirSync(join(root, 'tools'))
    executable(
        join(root, 'tools', 'bun'),
        '#!/bin/sh\nprintf \'package=%s\\n\' "$FT_NPM_PACKAGE"\nprintf \'arg=<%s>\\n\' "$@"\n',
    )
})

afterEach(() => {
    rmSync(root, { recursive: true, force: true })
})

it("finds its package through npm's link and lets the package's own ft set a scope up", () => {
    const result = spawnSync(join(root, 'bin', 'ft'), ['init', '--user'], {
        cwd: root,
        encoding: 'utf8',
        env: {
            PATH: `${join(root, 'tools')}:/usr/bin:/bin`,
            HOME: join(root, 'home'),
            XDG_CONFIG_HOME: join(root, 'config'),
            XDG_CACHE_HOME: join(root, 'cache'),
            FT_RELEASE_URL: 'http://127.0.0.1:9/never-requested',
        },
    })

    expect(result.stderr).toBe('')
    expect(result.stdout).toBe(
        `package=${installed}\narg=<${join(installed, 'src/cli.ts')}>\narg=<init>\narg=<--user>\n`,
    )
    expect(result.status).toBe(0)
})
