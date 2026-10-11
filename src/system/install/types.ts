/**
 * Pinned archive publication instructions for the generic installer.
 */
export interface InstallSpec {
    /** Protocol lock name, including pinned version. */
    name: string
    /** Immutable published directory under the cache root. */
    finalPath: string
    /** Exact pinned release archive download URL. */
    url: string
    /** Trusted archive digest, or all four runner target digests in project config. */
    sha256: string
    /** Executable path relative to extracted tree root. */
    binary: string
    /** Exact release version; never a floating tag. */
    version: string
}
