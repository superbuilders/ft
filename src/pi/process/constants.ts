export const KILL_GRACE_MS = 1500

/** Pi's command id for a follow-up prompt, numbered from 1, so its response is told apart from the brief's. */
export const CORRECTION_ID = 'correction'

/** How long a cancelled Pi has to end its turn after an RPC abort, before ft terminates it. */
export const ABORT_GRACE_MS = 2000
