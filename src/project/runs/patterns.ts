/** Matches a provider's complaint that the conversation outgrew the model's window. */
export const CONTEXT_OVERFLOW =
    /context (length|window)|maximum context|too many tokens|prompt is too long/i

/** Matches a provider refusing the request's credentials. */
export const AUTH_REJECTED =
    /\b(401|403)\b|unauthori[sz]ed|forbidden|authentication|(invalid|incorrect|missing) (x-)?api[ -_]?key/i
