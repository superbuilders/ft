import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

import { DEFAULT_LANE, DEFAULT_LANES } from '../../models/constants'
import { thinkingLevel, validateLane } from '../../models/models'
import { TARGETS } from '../../system/host/constants'
import { GATEWAY_URL } from './constants'

import type { Lane } from '../../models/types'
import type { Config, ResolvedConfig } from './types'

/**
 * Find the nearest config, honoring the shim handoff.
 * @param cwd - discovery start directory
 * @param handoff - explicit config path from the shim
 * @returns absolute config path, or undefined
 */
export function findConfig(cwd: string, handoff?: string): string | undefined {
    if (handoff) {
        return resolve(cwd, handoff)
    }

    let dir = resolve(cwd)

    while (true) {
        const path = join(dir, '.ft.json')

        if (existsSync(path)) {
            return path
        }

        const parent = dirname(dir)

        if (parent === dir) {
            return undefined
        }

        dir = parent
    }
}

/**
 * Require a JSON object.
 * @param value - untrusted JSON value
 * @returns a property map
 */
function object(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('Expected a JSON object')
    }

    return value as Record<string, unknown>
}

/**
 * Validate the binding config schema without discarding unknown keys when pinning.
 * @param value - parsed config
 * @returns validated config
 */
export function validateConfig(value: unknown): Config {
    const config = object(value)

    if (
        typeof config.version !== 'string' ||
        !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(config.version)
    ) {
        throw new Error('version must be a release version')
    }

    const hashes = object(config.sha256)

    for (const target of TARGETS) {
        if (typeof hashes[target] !== 'string' || !/^[a-fA-F0-9]{64}$/.test(hashes[target])) {
            throw new Error(`sha256.${target} must be 64 hex digits`)
        }
    }

    const key = object(config.apiKey)

    if ('command' in key === 'env' in key) {
        throw new Error('apiKey requires exactly one of command or env')
    }

    if (
        'command' in key &&
        (!Array.isArray(key.command) ||
            key.command.length === 0 ||
            !key.command.every(arg => typeof arg === 'string' && arg.length > 0))
    ) {
        throw new Error('apiKey.command must be a nonempty argv array')
    }

    if (
        'env' in key &&
        (typeof key.env !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key.env))
    ) {
        throw new Error('apiKey.env must be an environment variable name')
    }

    if (config.gateway !== undefined) {
        const gateway = object(config.gateway)

        if (typeof gateway.baseUrl !== 'string') {
            throw new Error('gateway.baseUrl must be a URL')
        }

        const url = new URL(gateway.baseUrl)

        if (
            !['http:', 'https:'].includes(url.protocol) ||
            url.username ||
            url.password ||
            url.search ||
            url.hash
        ) {
            throw new Error(
                'gateway.baseUrl must be an HTTP(S) URL without credentials, query or fragment',
            )
        }
    }

    if (config.lanes !== undefined) {
        for (const lane of Object.values(object(config.lanes))) {
            validateLane(object(lane))
        }
    }

    return config as unknown as Config
}

/**
 * Resolve and validate a project's configuration.
 * @param cwd - invocation directory
 * @returns config and built-in defaults merged with overrides
 */
export async function loadConfig(cwd: string): Promise<ResolvedConfig> {
    const path = findConfig(cwd, process.env.FT_CONFIG)

    if (!path) {
        throw new Error('No .ft.json found; run ft pin <version> in the project root')
    }

    const config = validateConfig(JSON.parse(await readFile(path, 'utf8')))

    return {
        path,
        root: dirname(path),
        config,
        baseUrl: (config.gateway?.baseUrl ?? GATEWAY_URL).replace(/\/+$/, ''),
        lanes: { ...DEFAULT_LANES, ...config.lanes },
    }
}

/**
 * Resolve one lane or one exact model, with an explicit thinking override.
 * @param config - resolved project configuration
 * @param lane - lane name; the default lane when neither lane nor model is given
 * @param model - exact model id
 * @param thinking - optional override
 * @returns the selected model and level
 */
export function resolveLane(
    config: ResolvedConfig,
    lane?: string,
    model?: string,
    thinking?: string,
): Lane {
    if (lane && model) {
        throw new Error('Choose at most one of --lane or --model')
    }

    const selected = model ? validateLane({ model }) : config.lanes[lane ?? DEFAULT_LANE]

    if (!selected) {
        throw new Error(`Unknown lane: ${lane}`)
    }

    return { ...selected, ...(thinking === undefined ? {} : { thinking: thinkingLevel(thinking) }) }
}
