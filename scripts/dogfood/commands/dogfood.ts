import { dogfood } from '../lib/dogfood'

/**
 * Install the last commit's ft as `ft` on PATH.
 * @returns resolves once it is installed
 */
export async function runDogfood(): Promise<void> {
    await dogfood()
}
