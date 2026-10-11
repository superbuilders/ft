import { SCENARIOS } from './constants'
import { PrerequisiteError } from './processes'

import type { Aggregate, Options, Result } from './types'

/**
 * Resolve explicit names or the complete non-real catalog, never both.
 * @param scenarios - positional scenario names
 * @param all - whether the non-real suite was requested
 * @returns selected names in invocation/catalog order
 */
export function selectScenarios(scenarios: string[], all = false): string[] {
    if (all && scenarios.length > 0) {
        throw new PrerequisiteError('Use scenario names or --all, not both')
    }

    if (all) {
        return Object.keys(SCENARIOS).filter(name => !name.startsWith('real-'))
    }

    if (scenarios.length === 0) {
        throw new PrerequisiteError('run requires one or more scenario names or --all')
    }

    return scenarios
}

/**
 * Aggregate host-major results with infrastructure, assertion, usage, pass precedence.
 * @param results - ordered per-scenario evidence
 * @param host - requested host(s)
 * @returns one minimal terminal envelope
 */
export function aggregate(results: Result[], host: Options['host']): Aggregate {
    const severity: Result['outcome'][] = ['lab_error', 'failed', 'prerequisite_error', 'passed']
    const outcome =
        severity.find(value => results.some(result => result.outcome === value)) ?? 'passed'

    return { schemaVersion: 1, host, outcome, results }
}

/**
 * Print one terminal scenario summary, separate from the JSON contract.
 * @param result - completed scenario result
 * @returns nothing
 */
export function summarize(result: Result): void {
    const failed = result.assertions
        .filter(assertion => !assertion.passed)
        .map(assertion => assertion.name)

    process.stderr.write(
        `${result.host} ${result.scenario}: ${result.outcome === 'passed' ? 'passed' : 'failed'}${failed.length ? ` ${failed.join(' ')}` : ''}\n`,
    )
}
