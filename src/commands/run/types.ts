/**
 * Commander inputs, validated before a run is created.
 */
export interface RunOptions {
    /** Readable part of the run id, for a single brief; defaults to the brief file's name. */
    name?: string
    /** For a single brief: a path that receives the answer on success, removed when the run fails. */
    out?: string
    /** Requested role name. */
    role?: string
    /** `provider/model` reference, chosen instead of a role. */
    model?: string
    /** Tool allowlist profile, read by default. */
    profile?: string
    /** Requested Pi thinking level. */
    thinking?: string
    /** Folder the run's tools work in, relative to the working directory; defaults to it. */
    workdir?: string
    /** Optional wall-clock deadline in seconds. */
    deadline?: string
    /** A JSON Schema file the final answer must match, relative to the working directory. */
    outputSchema?: string
    /** Print the status as JSON instead of the report. */
    json?: boolean
}
