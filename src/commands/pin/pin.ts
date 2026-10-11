import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { findConfig } from '../../project/config/config'
import { atomicWrite } from '../../system/files/atomic-write'
import { TARGETS } from '../../system/host/constants'
import { commandOutput } from '../../system/process/subprocess'

/**
 * Fetch a private release manifest through authenticated gh and preserve project overrides.
 * @param version - exact runner release version
 * @returns completion of pin publication
 */
export async function pin(version: string): Promise<void> {
    if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version)) {
        throw new Error('Expected a release version such as 0.1.0')
    }

    const sums = await commandOutput([
        'gh',
        'release',
        'download',
        `v${version}`,
        '-R',
        'superbuilders/ft',
        '-p',
        'SHA256SUMS',
        '-O',
        '-',
    ])
    const sha256: Record<string, string> = {}

    for (const target of TARGETS) {
        const matches = sums
            .split('\n')
            .map(line => /^([a-fA-F0-9]{64})  (\S+)\r?$/.exec(line))
            .filter(match => match?.[2] === `ft-${target}`)

        if (matches.length !== 1) {
            throw new Error(`Release manifest requires exactly one ft-${target} checksum`)
        }

        sha256[target] = matches[0]?.[1]?.toLowerCase() as string
    }

    const found = findConfig(process.cwd(), process.env.FT_CONFIG)
    const path = found ?? resolve('.ft.json')
    const config = found
        ? (JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>)
        : { apiKey: { env: 'FILL_IN_YOUR_API_KEY_ENV_VAR' } }

    if (!config || typeof config !== 'object' || Array.isArray(config)) {
        throw new Error('.ft.json must be an object')
    }

    await atomicWrite(path, `${JSON.stringify({ ...config, version, sha256 }, null, 4)}\n`)
    process.stderr.write(
        `Pinned ft ${version} in ${path}${found ? '' : '; fill in apiKey before running ft'}\n`,
    )
}
