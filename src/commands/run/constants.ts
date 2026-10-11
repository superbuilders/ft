/** A harness closing its terminal sends SIGHUP; treat it like Ctrl-C so Pi and its tools are stopped. */
export const CANCEL_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const

/** Pi tools each --profile allows; a tool-free model gets none whatever the profile. */
export const PROFILE_TOOLS: Record<string, readonly string[]> = {
    read: ['read', 'grep', 'find', 'ls', 'bash'],
    write: ['read', 'grep', 'find', 'ls', 'bash', 'edit', 'write'],
}
