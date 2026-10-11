import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, it, vi } from 'vitest'

import { getKey } from '../../project/key/key'
import { brokerKey, serveKey } from './key-broker'

import type { KeySource } from '../../models/types'

it("resolves a key command at the project root and brokers only the run provider's key", async () => {
    const root = await mkdtemp(join(tmpdir(), 'ft-key-'))

    try {
        await writeFile(join(root, 'credential.txt'), 'unit-test-dummy')

        let source: KeySource = {
            command: ['bun', '-e', "process.stdout.write(await Bun.file('credential.txt').text())"],
        }

        expect(await getKey(source, root)).toBe('unit-test-dummy')
        await mkdir(join(root, 'run'), { mode: 0o700 })

        const socket = join(root, 'run', 'key.sock')
        const close = serveKey(socket, { provider: 'gateway', value: await getKey(source, root) })

        try {
            expect(await brokerKey(socket, 'gateway')).toBe('unit-test-dummy')
            expect(await brokerKey(socket, 'gateway')).toBe('unit-test-dummy')
            await expect(brokerKey(socket, 'other')).rejects.toThrow('no key for that provider')

            /* Pi asks from its own process, where an instant answer used to beat the client's open and read as refused. */
            const client = `import { brokerKey } from ${JSON.stringify(join(import.meta.dirname, 'key-broker.ts'))}; process.stdout.write(await brokerKey(${JSON.stringify(socket)}, 'gateway'))`

            for (let attempt = 0; attempt < 5; attempt++) {
                const child = Bun.spawn([process.execPath, '-e', client], {
                    stdout: 'pipe',
                    stderr: 'inherit',
                })

                expect(await new Response(child.stdout).text()).toBe('unit-test-dummy')
                expect(await child.exited).toBe(0)
            }
        } finally {
            await close()
        }

        source = { env: 'TEST_FT_KEY' }
        vi.stubEnv('TEST_FT_KEY', '  unit-test-env  ')
        expect(await getKey(source, root)).toBe('unit-test-env')
        vi.stubEnv('TEST_FT_KEY', '')
        await expect(getKey(source, root)).rejects.toThrow('empty or unset')
        source = { command: ['bun', '-e', 'process.exit(7)'] }
        await expect(getKey(source, root)).rejects.toThrow('exit 7')

        const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
        const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        const literal = 'dummy key; $(printf injected) "quoted" \'single\''

        try {
            const printing = {
                command: [
                    'bun',
                    '-e',
                    'process.stdout.write(process.argv[1]); process.stderr.write(process.argv[1])',
                    '--',
                    literal,
                ],
            }

            expect(await getKey(printing, root)).toBe(literal)
            expect(await getKey(printing, root, new AbortController().signal)).toBe(literal)
            printing.command = [
                'bun',
                '-e',
                'process.stdout.write(process.argv[1]); process.stderr.write(process.argv[1]); process.exit(7)',
                '--',
                literal,
            ]
            await expect(getKey(printing, root)).rejects.toThrow('Key command failed (exit 7)')
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
