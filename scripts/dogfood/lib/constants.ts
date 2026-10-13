/** Prerelease tag the dogfood build carries, so `ft-dev --version` says it is not a release. */
export const DOGFOOD_TAG = 'dogfood'

/**
 * Where the dogfood build goes, under the home directory: beside the installed `ft`, on PATH as
 * `ft-dev`, so it never replaces the real install or the launcher's pinned versions.
 */
export const INSTALL_PATH = ['.local', 'bin', 'ft-dev'] as const
