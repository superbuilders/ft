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
 * Describe one schema error as a line a person can act on, at the dotted path they read in the file.
 * @param error - one schema error
 * @returns problem lines; an unknown-field error yields one per field
 */
function schemaProblems(error: TLocalizedValidationError): string[] {
    const path = error.instancePath.replace(/^\//, '').replaceAll('/', '.')

    /**
     * Join a field name onto the error's path.
     * @param field - the field the error names
     * @returns dotted path to that field
     */
    function at(field: string): string {
        return path ? `${path}.${field}` : field
    }

    switch (error.keyword) {
        case 'required': {
            return error.params.requiredProperties.map(field => `${at(field)}: required`)
        }

        case 'additionalProperties': {
            return error.params.additionalProperties.map(field =>
                FORBIDDEN_PROVIDER_FIELDS.includes(field as (typeof FORBIDDEN_PROVIDER_FIELDS)[number])
                    ? `${at(field)}: put credentials in key (env or command), never in config`
                    : `${at(field)}: not a field ft or Pi reads`,
            )
        }

        case 'enum': {
            return [`${path || 'root'}: must be one of ${error.params.allowedValues.join(', ')}`]
        }

        default: {
            return [`${path || 'root'}: ${error.message}`]
        }
    }
}

/**
 * Whether a base URL is HTTP(S) with no credentials, query or fragment.
 * @param value - candidate URL
 * @returns true when ft can use it as a provider endpoint
 */
function cleanUrl(value: string): boolean {
    const url = URL.parse(value)

    return (
        url !== null &&
        ['http:', 'https:'].includes(url.protocol) &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash
    )
}

/**
 * Read a provider's base URL, from its environment variable when the config names one.
 * @param id - provider id, for messages
 * @param provider - validated provider
 * @returns the URL, or undefined for a built-in provider using Pi's endpoint
 */
export function resolveBaseUrl(id: string, provider: Provider): string | undefined {
    if (provider.baseUrl === undefined || typeof provider.baseUrl === 'string') {
        return provider.baseUrl
    }

    const value = process.env[provider.baseUrl.env]?.trim()

    if (!value) {
        throw new Error(`providers.${id}.baseUrl: environment variable ${provider.baseUrl.env} is empty or unset`)
    }

    if (!cleanUrl(value)) {
        throw new Error(
            `providers.${id}.baseUrl: ${provider.baseUrl.env} must be an HTTP(S) URL without credentials, query or fragment`,
        )
    }

    return value
}

/**
 * Check what the schema cannot: custom providers are complete, URLs are clean, adapters can be relayed.
 * @param id - provider id
 * @param provider - schema-valid provider
 * @returns problems, empty when the provider is valid
 */
function providerProblems(id: string, provider: Provider): string[] {
    const problems: string[] = []

    if (!isBuiltinProvider(id)) {
        for (const field of ['baseUrl', 'api', 'models'] as const) {
            if (provider[field] === undefined) {
                problems.push(
                    `providers.${id}.${field}: required, because ${id} is not one of Pi's built-in providers`,
                )
            }
        }
    }

    if (typeof provider.baseUrl === 'string' && !cleanUrl(provider.baseUrl)) {
        problems.push(
            `providers.${id}.baseUrl: must be an HTTP(S) URL without credentials, query or fragment`,
        )
    }

    const ids = (provider.models ?? []).map(model => model.id)

    for (const duplicate of new Set(ids.filter((model, index) => ids.indexOf(model) !== index))) {
        problems.push(`providers.${id}.models: lists ${duplicate} more than once`)
    }

    for (const model of provider.models ?? []) {
        if (model.adapter === undefined) {
            continue
        }

        if (provider.baseUrl === undefined) {
            problems.push(
                `providers.${id}.baseUrl: required, because model ${model.id} uses an adapter`,
            )
        }

        /* ft relays an adapted model through the provider's URL; a model URL would go around the relay. */
        if (model.baseUrl !== undefined) {
            problems.push(
                `providers.${id}.models: ${model.id} uses an adapter, so it cannot set its own baseUrl`,
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
        problems = [...new Set(configValidator.Errors(value).flatMap(schemaProblems))]
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
