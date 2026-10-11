import { createConnection, createServer } from 'node:net'

import { runCommand } from './shell'

import type { ResolvedConfig } from './types'

/**
 * Resolve the key without ever writing it to diagnostic output.
 * @param config - key source and project root
 * @param signal - cancellation for a running command
 * @returns trimmed credential held only in memory
 */
export async function getKey(config: ResolvedConfig, signal?: AbortSignal): Promise<string> {
    const source = config.config.apiKey

    if ('env' in source) {
        const key = process.env[source.env]?.trim()

        if (!key) {
            throw new Error(`Key environment variable ${source.env} is empty or unset`)
        }

        return key
    }

    const result = await runCommand(source.command, config.root, signal)

    if (result.exitCode !== 0) {
        throw new Error(`Key command failed (exit ${result.exitCode})`)
    }

    /* Command stderr may contain the credential too; never forward either captured pipe. */
    const key = result.stdout.toString('utf8').trim()

    if (!key) {
        throw new Error('Key command returned empty stdout')
    }

    return key
}

/**
 * Serve a credential over a private run-local socket, keeping caller credentials out of Pi's environment.
 * @param path - socket inside the mode-0700 run directory
 * @param config - caller key configuration
 * @param signal - run cancellation
 * @returns asynchronous server cleanup
 */
export async function serveKey(
    path: string,
    config: ResolvedConfig,
    signal: AbortSignal,
): Promise<() => Promise<void>> {
    let key: Promise<string> | undefined
    const server = createServer(socket => {
        key ??= getKey(config, signal)
        void key.then(
            value => socket.end(JSON.stringify({ key: value })),
            () => socket.end(JSON.stringify({ error: 'Key resolution failed; see ft stderr' })),
        )
        socket.on('error', () => socket.destroy())
    })

    await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(path, resolve)
    })

    return () =>
        new Promise<void>((resolve, reject) =>
            server.close(error => (error ? reject(error) : resolve())),
        )
}

/**
 * Read the run-local key broker from the subprocess invoked by Pi.
 * @param path - private socket path
 * @returns the brokered credential
 */
export async function brokerKey(path: string): Promise<string> {
    const raw = await new Promise<string>((resolve, reject) => {
        const socket = createConnection(path)
        const chunks: Buffer[] = []

        socket.on('data', (chunk: Buffer) => chunks.push(chunk))
        socket.on('error', reject)
        socket.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    })
    const response = JSON.parse(raw) as { key?: string; error?: string }

    if (!response.key) {
        throw new Error(response.error ?? 'Key broker returned no key')
    }

    return response.key
}
