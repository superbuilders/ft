import { release } from '../lib/release'

/**
 * Cut one release from the current main.
 * @param version - bump kind or exact version
 * @returns resolves once the tag is pushed
 */
export async function runRelease(version: string): Promise<void> {
    await release(version)
}
