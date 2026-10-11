import { version } from '../package.json'

declare const FT_BUILD_VERSION: string | undefined

/** The version this runner reports: a lab build's compile-time override, otherwise package.json's. */
export const RUNNER_VERSION = typeof FT_BUILD_VERSION === 'undefined' ? version : FT_BUILD_VERSION
