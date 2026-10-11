// Keep in sync with playcademy-arcade's checks and pre-push-log contracts.

/** The pre-push hook distinguishes reported check failures from runner crashes. */
export const CHECKS_FAILED_EXIT_CODE = 3

/** One checkout-local log, replaced on each run; tmp/ is gitignored. */
export const CHECK_LOG_PATH = 'tmp/pre-push.log'
