import { createConnection, createServer } from 'node:net'

import { getKey } from '../../project/key/key'

import type { ResolvedConfig } from '../../project/config/types'

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
