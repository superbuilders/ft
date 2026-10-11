import { checkRefusal, fullGatesAllowed } from '../../lib/run-context'
import { runChecks } from '../lib/checks'

import type { CheckOptions } from '../lib/types'

/**
 * Refuse ad-hoc full gates, otherwise delegate to the check runner.
 *
 * @param options - commander mode flags
 * @returns resolves after the checks have reported their results
 */
export async function runCheck(options: CheckOptions): Promise<void> {
    if (!fullGatesAllowed(process.env)) {
        console.error(checkRefusal())
        process.exitCode = 1

        return
    }

    process.exitCode = await runChecks(options)
}
