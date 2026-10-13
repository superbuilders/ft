import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { version as packageVersion } from '../../../package.json'
import { TARGETS } from '../../../src/system/host/constants'
import { platformTarget } from '../../../src/system/host/host'
import { command } from './processes'

import type { Build } from './types'

/**
 * Hash final bytes, including Darwin's ad-hoc signature.
 * @param path - artifact path
 * @returns SHA-256 hex digest
 */
export async function digest(path: string): Promise<string> {
    return createHash('sha256')
        .update(await readFile(path))
        .digest('hex')
}

/**
 * Every target's runner checksum for a lab release or lock. A lock needs every target's, but the
 * lab builds and runs only this host's, so the others are placeholders.
 * @param target - the built runner's platform target
 * @param runner - its SHA-256
 * @returns checksum per target
 */
export function labChecksums(target: string, runner: string): Record<string, string> {
    return Object.fromEntries(
        TARGETS.map(other => [other, other === target ? runner : '0'.repeat(64)]),
    )
}

/**
 * Fill a folder holding only ft-<target> with the rest of a release: the shim, installer, config
 * schema and SHA256SUMS.
 * @param directory - folder holding the runner binary
 * @param target - the binary's platform target
 * @returns the runner's SHA-256, once SHA256SUMS is written
 */
async function completeRelease(directory: string, target: string): Promise<string> {
    await copyFile('shim/ft', join(directory, 'ft-shim'))
    await copyFile('install.sh', join(directory, 'install.sh'))

    const schema = await command([join(directory, `ft-${target}`), 'schema'])

    await writeFile(join(directory, 'schema.json'), schema.stdout)

    const assets = ['ft-shim', 'install.sh', 'schema.json']
    const [runner = '', ...digests] = await Promise.all(
        [`ft-${target}`, ...assets].map(asset => digest(join(directory, asset))),
    )
    const lines = [
        ...Object.entries(labChecksums(target, runner)).map(
            ([other, sum]) => `${sum}  ft-${other}`,
        ),
        ...assets.map((asset, index) => `${digests[index]}  ${asset}`),
    ]

    await writeFile(join(directory, 'SHA256SUMS'), lines.map(line => `${line}\n`).join(''))

    return runner
}

/**
 * Compile natively and atomically cache a release-shaped bundle by its inputs.
 * @param cache - lab-owned cache root
 * @param salt - deterministic second-build discriminator for switch
 * @returns verified build metadata
 */
export async function build(cache: string, salt = ''): Promise<Build> {
    const target = platformTarget()
    const hash = createHash('sha256').update(
        `${Bun.version}\0${target}\0${salt}\0native-compile-v1`,
    )
    const sources = await Array.fromAsync(new Bun.Glob('src/**/*.ts').scan('.'))
    const paths = [
        'package.json',
        'bun.lock',
        'shim/ft',
        'install.sh',
        '.agents/skills/ft/SKILL.md',
        'scripts/lab/lib/build.ts',
        /* Tests are not compiled into the runner, so editing one must not force a rebuild. */
        ...sources.filter(path => !path.endsWith('.test.ts')),
    ].toSorted()

    for (const path of paths) {
        hash.update(path).update(await readFile(path))
    }

    const version = `${packageVersion}-lab.${hash.digest('hex').slice(0, 16)}`
    const directory = join(cache, 'builds', version)
    const binary = join(directory, `ft-${target}`)

    if (!existsSync(join(directory, 'SHA256SUMS'))) {
        const stage = `${directory}.${crypto.randomUUID()}`

        await mkdir(stage, { recursive: true, mode: 0o700 })

        try {
            const output = join(stage, `ft-${target}`)

            await command([
                process.execPath,
                'build',
                '--compile',
                'src/cli.ts',
                '--define',
                `FT_BUILD_VERSION=${JSON.stringify(version)}`,
                '--outfile',
                output,
            ])

            if (process.platform === 'darwin') {
                await command(['codesign', '--force', '--sign', '-', output])
            }

            await completeRelease(stage, target)
            await mkdir(join(cache, 'builds'), { recursive: true })

            try {
                await rename(stage, directory)
            } catch (error) {
                if (!existsSync(join(directory, 'SHA256SUMS'))) {
                    throw error
                }
            }
        } finally {
            await rm(stage, { recursive: true, force: true })
        }
    }

    const sha256 = await digest(binary)
    const sums = await readFile(join(directory, 'SHA256SUMS'), 'utf8')
    const reported = await command([binary, '--version'])

    if (!sums.includes(`${sha256}  ft-${target}\n`) || reported.stdout.trim() !== version) {
        throw new Error('Cached build identity mismatch')
    }

    return { version, digest: sha256, directory, binary, target }
}

/**
 * Test a binary built elsewhere, such as the release workflow's freshly signed runner, so the lab
 * tests the exact bytes that will ship. The folder needs only ft-<target>; the rest of the release
 * is added from this checkout.
 * @param directory - folder holding ft-<target>
 * @returns build metadata read from the binary itself
 */
export async function prebuilt(directory: string): Promise<Build> {
    const target = platformTarget()
    const absolute = resolve(directory)
    const binary = join(absolute, `ft-${target}`)

    const runner = await completeRelease(absolute, target)
    const reported = await command([binary, '--version'])

    return {
        version: reported.stdout.trim(),
        digest: runner,
        directory: absolute,
        binary,
        target,
    }
}
