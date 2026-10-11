export const FROZEN_SETTINGS = {
    defaultProjectTrust: 'never',
    enableInstallTelemetry: false,
    enableAnalytics: false,
    theme: 'dark',
    packages: [],
    extensions: [],
    skills: [],
    prompts: [],
    themes: [],
} as const

/* What the key client sends once its end is open; the broker answers only after hearing it. */
export const KEY_REQUEST = 'key'
