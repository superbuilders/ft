export const TARGETS = ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64'] as const

/** A line only the ft launcher has, so ft never mistakes some other program named ft for it. */
export const LAUNCHER_MARKER = 'SHIM_VERSION='
