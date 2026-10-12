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
    const paths = [
        'package.json',
        'bun.lock',
        'shim/ft',
        'install.sh',
        '.agents/skills/ft/SKILL.md',
        'scripts/lab/lib/build.ts',
        ...(await Array.fromAsync(new Bun.Glob('src/**/*.ts').scan('.'))),
    ].toSorted()

    for (const path of paths) {
        hash.update(path).update(await readFile(path))
    }

    const version = `${packageVersion}-lab.${hash.digest('hex').slice(0, 16)}`
    const directory = join(cache, 'builds', version)
    const binary = join(directory, `ft-${target}`)

    if (!existsSync(join(directory, 'SHA256SUMS'))) {
        process.stderr.write(`[lab] build ${target} ${version}\n`)

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

            await copyFile('shim/ft', join(stage, 'ft-shim'))
            await copyFile('install.sh', join(stage, 'install.sh'))
            await copyFile('.agents/skills/ft/SKILL.md', join(stage, 'SKILL.md'))

            const schema = await command([output, 'schema'])

            await writeFile(join(stage, 'schema.json'), schema.stdout)

            const assets = [`ft-${target}`, 'ft-shim', 'install.sh', 'schema.json', 'SKILL.md']
            const sums = await Promise.all(
                assets.map(async asset => `${await digest(join(stage, asset))}  ${asset}\n`),
            )
            /* A lock needs every target's checksum; the lab builds and runs only this one. */
            const absent = TARGETS.filter(other => other !== target).map(
                other => `${'0'.repeat(64)}  ft-${other}\n`,
            )

            await writeFile(join(stage, 'SHA256SUMS'), [...sums, ...absent].join(''))
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
 * Use an existing release-shaped folder, such as the release workflow's freshly signed
 * binary, so the lab tests the exact bytes that will ship.
 * @param directory - folder holding ft-<target>, ft-shim, install.sh and SHA256SUMS
 * @returns build metadata read from the binary itself
 */
export async function prebuilt(directory: string): Promise<Build> {
    const target = platformTarget()
    const absolute = resolve(directory)
    const binary = join(absolute, `ft-${target}`)
    const sha256 = await digest(binary)
    const sums = await readFile(join(absolute, 'SHA256SUMS'), 'utf8')

    if (!sums.includes(`${sha256}  ft-${target}\n`)) {
        throw new Error(`SHA256SUMS in ${absolute} does not list ft-${target} with its actual hash`)
    }

    const reported = await command([binary, '--version'])

    return { version: reported.stdout.trim(), digest: sha256, directory: absolute, binary, target }
}
