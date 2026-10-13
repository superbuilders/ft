/**
 * Text styles for one output stream; each returns the text unchanged where styling is off.
 */
export interface Style {
    /** Whether styling is on for this stream. */
    on: boolean
    /** The thing itself: a run id, a version. */
    bold: (text: string) => string
    /** Secondary detail: paths, timings, hints. */
    dim: (text: string) => string
    /** Success. */
    green: (text: string) => string
    /** Failure. */
    red: (text: string) => string
    /** In progress. */
    yellow: (text: string) => string
    /** A command to run next. */
    cyan: (text: string) => string
    /** A leading ✔ or ✗ and a space where styling is on; nothing where it is off. */
    mark: (ok: boolean) => string
}

/**
 * What a setup command reports it did.
 */
export interface Summary {
    /** One line naming the result, e.g. `Pinned ft 0.1.0 for this repository`. */
    done: string
    /** Label and value pairs: what was written, kept or removed. */
    rows: [string, string][]
    /** Sentences after the rows; a command in backticks is styled as one. */
    notes?: string[]
    /** What to do next, in order; a command in backticks is styled as one. */
    steps?: string[]
}
