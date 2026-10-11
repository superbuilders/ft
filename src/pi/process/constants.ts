export const KILL_GRACE_MS = 1500

/** Pi tools each --profile allows; a tool-free model gets none whatever the profile. */
export const PROFILE_TOOLS: Record<string, readonly string[]> = {
    read: ['read', 'grep', 'find', 'ls', 'bash'],
    write: ['read', 'grep', 'find', 'ls', 'bash', 'edit', 'write'],
}
