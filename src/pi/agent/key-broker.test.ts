import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, it, vi } from 'vitest'

import { loadConfig } from '../../project/config/config'
import { getKey } from '../../project/key/key'
import { TARGETS } from '../../system/host/constants'
import { brokerKey, serveKey } from './key-broker'

it('resolves a key command at the config root and brokers it once without an inherited credential', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ft-key-'))

    try {
        await writeFile(join(root, 'credential.txt'), 'unit-test-dummy')
        await writeFile(
            join(root, '.ft.json'),
            JSON.stringify({
                version: '0.1.0',
                sha256: Object.fromEntries(TARGETS.map(target => [target, 'a'.repeat(64)])),
                apiKey: {
                    command: [
                        'bun',
                        '-e',
                        "process.stdout.write(await Bun.file('credential.txt').text())",
                    ],
                },
            }),
        )
        vi.stubEnv('FT_CONFIG', join(root, '.ft.json'))

        const config = await loadConfig(root)

        expect(await getKey(config)).toBe('unit-test-dummy')
        await mkdir(join(root, 'run'), { mode: 0o700 })

        const socket = join(root, 'run', 'key.sock')
        const close = await serveKey(socket, config, new AbortController().signal)

        try {
            expect(await brokerKey(socket)).toBe('unit-test-dummy')
            expect(await brokerKey(socket)).toBe('unit-test-dummy')
        } finally {
            await close()
        }

        config.config.apiKey = { env: 'TEST_FT_KEY' }
        vi.stubEnv('TEST_FT_KEY', '  unit-test-env  ')
        expect(await getKey(config)).toBe('unit-test-env')
        vi.stubEnv('TEST_FT_KEY', '')
        await expect(getKey(config)).rejects.toThrow('empty or unset')
        config.config.apiKey = { command: ['bun', '-e', 'process.exit(7)'] }
        await expect(getKey(config)).rejects.toThrow('exit 7')

        const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
        const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        const literal = 'dummy key; $(printf injected) "quoted" \'single\''

        try {
            config.config.apiKey = {
                command: [
                    'bun',
                    '-e',
                    'process.stdout.write(process.argv[1]); process.stderr.write(process.argv[1])',
                    '--',
                    literal,
                ],
            }
            expect(await getKey(config)).toBe(literal)
            expect(await getKey(config, new AbortController().signal)).toBe(literal)
            config.config.apiKey.command = [
                'bun',
                '-e',
                'process.stdout.write(process.argv[1]); process.stderr.write(process.argv[1]); process.exit(7)',
                '--',
                literal,
            ]
            await expect(getKey(config)).rejects.toThrow('Key command failed (exit 7)')
            expect(stdout).not.toHaveBeenCalled()
            expect(stderr).not.toHaveBeenCalled()
        } finally {
            stdout.mockRestore()
            stderr.mockRestore()
        }
    } finally {
        vi.unstubAllEnvs()
        await rm(root, { recursive: true, force: true })
    }
})
