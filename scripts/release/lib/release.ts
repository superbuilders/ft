import { readFile, writeFile } from 'node:fs/promises'

import { commandOutput } from '../../../src/system/process/subprocess'
import { runStep } from '../../lib/run-step'
import { BUMPS, RELEASE_BRANCH, REPOSITORY } from './constants'

/**
 * Work out the version to release from the current one.
 * @param current - package.json's version
 * @param requested - patch, minor, major, or an exact x.y.z
 * @returns the version to tag
 */
export function nextVersion(current: string, requested: string): string {
    const [major, minor, patch] = current.split('.').map(Number) as [number, number, number]

    if (requested === 'major') {
        return `${major + 1}.0.0`
    }

    if (requested === 'minor') {
        return `${major}.${minor + 1}.0`
    }

    if (requested === 'patch') {
        return `${major}.${minor}.${patch + 1}`
    }

    if (!/^\d+\.\d+\.\d+$/.test(requested)) {
        throw new Error(`Version must be ${BUMPS.join(', ')} or x.y.z, not ${requested}`)
    }

    return requested
}

/**
 * Run git with literal arguments and return its trimmed output.
 * @param args - git arguments
 * @returns stdout without surrounding whitespace
 */
async function git(...args: string[]): Promise<string> {
    const output = await commandOutput(['git', ...args])

    return output.trim()
}

/**
 * Refuse to release anything but a clean main that matches GitHub and passed CI.
 * @param tag - the tag about to be created
 * @returns resolves when every precondition holds
 */
async function preflight(tag: string): Promise<void> {
    if ((await git('branch', '--show-current')) !== RELEASE_BRANCH) {
        throw new Error(`Release from ${RELEASE_BRANCH}`)
    }

    if (await git('status', '--porcelain')) {
        throw new Error('Commit or discard local changes first')
    }

    await git('fetch', '--tags', 'origin', RELEASE_BRANCH)

    const head = await git('rev-parse', 'HEAD')

    if (head !== (await git('rev-parse', `origin/${RELEASE_BRANCH}`))) {
        throw new Error(
            `Local ${RELEASE_BRANCH} must match origin/${RELEASE_BRANCH}; push or pull first`,
        )
    }

    if (await git('tag', '--list', tag)) {
        throw new Error(`${tag} already exists`)
    }

    const runs = JSON.parse(
        await commandOutput([
            'gh',
            'run',
            'list',
            '-R',
            REPOSITORY,
            '--workflow',
            'ci.yml',
            '--commit',
            head,
            '--json',
            'conclusion',
        ]),
    ) as { conclusion: string }[]

    if (!runs.some(run => run.conclusion === 'success')) {
        throw new Error(`CI has not passed on ${head.slice(0, 7)} yet`)
    }
}

/**
 * Bump package.json when needed, tag the version and push both; release.yml does the rest.
 * @param requested - patch, minor, major, or an exact x.y.z
 * @returns resolves once the tag is on GitHub
 */
export async function release(requested: string): Promise<void> {
    const manifest = await readFile('package.json', 'utf8')
    const current = (JSON.parse(manifest) as { version: string }).version
    const version = nextVersion(current, requested)
    const tag = `v${version}`

    await runStep(`Checking ${RELEASE_BRANCH} is ready for ${tag}`, () => preflight(tag))
    await runStep(
        `Tagging and pushing ${tag}`,
        async () => {
            if (version !== current) {
                await writeFile(
                    'package.json',
                    manifest.replace(`"version": "${current}"`, `"version": "${version}"`),
                )
                await git('commit', '--all', '--message', `Release ${tag}`)
            }

            await git('tag', '--annotate', tag, '--message', tag)
            await git('push', '--atomic', 'origin', RELEASE_BRANCH, tag)
        },
        `Pushed ${tag}`,
    )
    console.log(`Release build: https://github.com/${REPOSITORY}/actions/workflows/release.yml`)
}
