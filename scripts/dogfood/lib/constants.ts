/** Prerelease tag the dogfood build carries, so `ft --version` says it is not a release. */
export const DOGFOOD_TAG = 'dogfood'

/** Where the dogfood binary goes, under the home directory; it is on PATH as plain `ft`. */
export const INSTALL_PATH = ['.local', 'bin', 'ft'] as const
