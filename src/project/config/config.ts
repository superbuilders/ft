import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

import { isBuiltinProvider } from '../../models/catalog'
import { findModel } from '../../models/models'
import { CONFIG_FILE, FORBIDDEN_PROVIDER_FIELDS } from './constants'
import { configValidator } from './schema'

import type { TLocalizedValidationError } from 'typebox/error'

import type { Provider } from '../../models/types'
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
        const path = join(dir, CONFIG_FILE)

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
 * Turn a schema error's JSON pointer into the dotted path a person reads in the file.
 * @param error - one schema error
 * @returns dotted path, or `root`
 */
function errorPath(error: TLocalizedValidationError): string {
    const path = error.instancePath.replace(/^\//, '').replaceAll('/', '.')
    const missing = error.keyword === 'required' ? error.params.requiredProperties[0] : undefined

    if (missing) {
        return path ? `${path}.${missing}` : missing
    }

    return path || 'root'
}

/**
 * Check what the schema cannot: custom providers are complete, URLs are clean, refs resolve.
 * @param id - provider id
 * @param provider - schema-valid provider
 * @returns problems, empty when the provider is valid
 */
function providerProblems(id: string, provider: Provider): string[] {
    const problems = FORBIDDEN_PROVIDER_FIELDS.filter(field => field in provider).map(
        field =>
            `providers.${id}.${field}: put credentials in key (env or command), never in config`,
    )

    if (!isBuiltinProvider(id)) {
        for (const field of ['baseUrl', 'api', 'models'] as const) {
            if (provider[field] === undefined) {
                problems.push(
                    `providers.${id}.${field}: required, because ${id} is not one of Pi's built-in providers`,
                )
            }
        }
    }

    if (provider.baseUrl !== undefined) {
        const url = URL.parse(provider.baseUrl)

        if (
            !url ||
            !['http:', 'https:'].includes(url.protocol) ||
            url.username ||
            url.password ||
            url.search ||
            url.hash
        ) {
            problems.push(
                `providers.${id}.baseUrl: must be an HTTP(S) URL without credentials, query or fragment`,
            )
        }
    }

    const ids = (provider.models ?? []).map(model => model.id)

    for (const duplicate of new Set(ids.filter((model, index) => ids.indexOf(model) !== index))) {
        problems.push(`providers.${id}.models: lists ${duplicate} more than once`)
    }

    for (const model of provider.models ?? []) {
        if (model.adapter !== undefined && provider.baseUrl === undefined) {
            problems.push(
                `providers.${id}.baseUrl: required, because model ${model.id} uses an adapter`,
            )
        }
    }

    return problems
}

/**
 * Validate a parsed `.ft.json`.
 * @param value - parsed JSON
 * @returns the config, or throws listing every problem
 */
export function validateConfig(value: unknown): Config {
    if (value && typeof value === 'object' && ('version' in value || 'sha256' in value)) {
        throw new Error('version and sha256 now live in .ft.lock: remove them and run ft pin')
    }

    let problems: string[]

    if (configValidator.Check(value)) {
        const config = value as Config

        problems = Object.entries(config.providers).flatMap(([id, provider]) =>
            providerProblems(id, provider),
        )

        for (const [name, lane] of Object.entries(config.lanes)) {
            try {
                findModel(config.providers, lane.model)
            } catch (error) {
                problems.push(`lanes.${name}.model: ${(error as Error).message}`)
            }
        }
    } else {
        problems = configValidator
            .Errors(value)
            .map(
                error =>
                    `${errorPath(error)}: ${error.keyword === 'enum' ? `must be one of ${error.params.allowedValues.join(', ')}` : error.message}`,
            )
    }

    if (problems.length > 0) {
        throw new Error(
            `Invalid ${CONFIG_FILE}:\n${problems.map(problem => `  - ${problem}`).join('\n')}`,
        )
    }

    return value as Config
}

/**
 * Find, read and validate the project's configuration.
 * @param cwd - invocation directory
 * @returns the config and its location
 */
export async function loadConfig(cwd: string): Promise<ResolvedConfig> {
    const path = findConfig(cwd, process.env.FT_CONFIG)

    if (!path) {
        throw new Error(`No ${CONFIG_FILE} found; run ft pin <version> in the project root`)
    }

    return {
        path,
        root: dirname(path),
        config: validateConfig(JSON.parse(await readFile(path, 'utf8'))),
    }
}
