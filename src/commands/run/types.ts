/**
 * Commander inputs, validated before a run is created.
 */
export interface RunOptions {
    /** Brief file path relative to invocation cwd, or `-` to read it from stdin. */
    brief: string
    /** Readable part of the run id; defaults to the brief file's name. */
    name?: string
    /** Optional path that receives the answer on success and is removed when the run fails. */
    out?: string
    /** Requested lane name. */
    lane?: string
    /** `provider/model` reference, chosen instead of a lane. */
    model?: string
    /** Directory the run's tools work in. */
    cwd?: string
    /** Tool allowlist profile, read by default. */
    profile?: string
    /** Requested Pi thinking level. */
    thinking?: string
    /** Optional wall-clock deadline in seconds. */
    deadline?: string
    /** Print the status as JSON instead of the report. */
    json?: boolean
}
