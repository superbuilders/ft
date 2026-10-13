import { dogfood, removeDogfood } from '../lib/dogfood'

/**
 * Install the last commit's ft as `ft-dev` on PATH, or remove it.
 * @param options - command options
 * @param options.remove - remove `ft-dev` instead of installing it
 * @returns resolves once it is installed or removed
 */
export async function runDogfood(options: { remove?: boolean }): Promise<void> {
    await (options.remove ? removeDogfood() : dogfood())
}
