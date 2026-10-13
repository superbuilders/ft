/**
 * One provider's line in the doctor report, and whether it counts as a problem.
 */
export interface ProviderCheck {
    /** The provider id and what was found. */
    row: [string, string]
    /** Whether the check failed. */
    problem: boolean
}
