/** The package script `ft init` adds, so a repository runs its launcher as `bun ft` or `npm run ft`. */
export const PACKAGE_SCRIPT = { name: 'ft', command: 'sh .ft/ft' } as const

/** Lockfiles that name a repository's package manager, first match wins; npm otherwise. */
export const LOCKFILES = [
    ['bun.lock', 'bun'],
    ['bun.lockb', 'bun'],
    ['pnpm-lock.yaml', 'pnpm'],
    ['yarn.lock', 'yarn'],
] as const
