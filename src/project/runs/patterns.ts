/** Matches a provider refusing the request: a bad key, or one not allowed this model. */
export const AUTH_REJECTED =
    /\b(401|403)\b|unauthori[sz]ed|forbidden|authentication|(invalid|incorrect|missing) (x-)?api[ -_]?key/i
