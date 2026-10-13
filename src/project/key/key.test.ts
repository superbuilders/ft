import { afterEach, expect, it, vi } from 'vitest'

import { getKey } from './key'

afterEach(() => {
    vi.unstubAllEnvs()
})

it('reads a key from the environment', async () => {
    vi.stubEnv('FT_TEST_KEY', ' sk-test \n')

    expect(await getKey({ env: 'FT_TEST_KEY' }, process.cwd())).toBe('sk-test')
})

it('refuses a pi shell command copied in as the key, without printing it', async () => {
    vi.stubEnv('FT_TEST_KEY', '!security find-generic-password -w -s secret-name')

    await expect(getKey({ env: 'FT_TEST_KEY' }, process.cwd())).rejects.toThrow(
        /^key environment variable FT_TEST_KEY looks like a pi shell command \(use \{"command": \["sh", "-c", "…"\]\} as the key instead\)$/,
    )
})
