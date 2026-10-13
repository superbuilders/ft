/**
 * Commander inputs, validated before a run is created.
 */
export interface RunOptions {
    /** Readable part of the run id, for a single brief; defaults to the brief file's name. */
    name?: string
    /** For a single brief: a path that receives the answer on success, removed when the run fails. */
    out?: string
    /** Requested lane name. */
    lane?: string
    /** `provider/model` reference, chosen instead of a lane. */
    model?: string
    /** Tool allowlist profile, read by default. */
    profile?: string
    /** Requested Pi thinking level. */
    thinking?: string
    /** Optional wall-clock deadline in seconds. */
    deadline?: string
    /** Print the status as JSON instead of the report. */
    json?: boolean
}
