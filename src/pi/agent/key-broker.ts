import { getKey } from '../../project/key/key'

import type { KeySource } from '../../models/types'

/**
 * Serve the run provider's credential over a private run-local socket, keeping caller credentials
 * out of Pi's environment. The client speaks first, naming the provider, and the server answers only
 * then: Bun's client reports a connect as refused when the server writes and hangs up before the
 * client has finished opening its end.
 * @param path - socket inside the mode-0700 run directory
 * @param key - the run's provider and its key source
 * @param key.provider - the only provider id this broker answers for
 * @param key.source - where the credential comes from
 * @param key.root - project root, the key command's working directory
 * @param signal - run cancellation
 * @returns asynchronous server cleanup
 */
export function serveKey(
    path: string,
    key: { provider: string; source: KeySource; root: string },
    signal: AbortSignal,
): () => Promise<void> {
    let value: Promise<string> | undefined
    const server = Bun.listen({
        unix: path,
        socket: {
            open() {},
            data(socket, chunk) {
                if (Buffer.from(chunk).toString('utf8') !== key.provider) {
                    socket.end(JSON.stringify({ error: 'This run has no key for that provider' }))

                    return
                }

                value ??= getKey(key.source, key.root, signal)
                void value.then(
                    resolved => socket.end(JSON.stringify({ key: resolved })),
                    () =>
                        socket.end(
                            JSON.stringify({ error: 'Key resolution failed; see ft stderr' }),
                        ),
                )
            },
            error(socket) {
                socket.terminate()
            },
        },
    })

    return async () => {
        server.stop(true)
    }
}

/**
 * Read the run-local key broker from the subprocess invoked by Pi.
 * @param path - private socket path
 * @param provider - provider id whose key Pi asked for
 * @returns the brokered credential
 */
export async function brokerKey(path: string, provider: string): Promise<string> {
    const decoder = new TextDecoder()
    let raw = ''

    await new Promise<void>((resolve, reject) => {
        Bun.connect({
            unix: path,
            socket: {
                open(socket) {
                    socket.write(provider)
                },
                data(_socket, chunk) {
                    raw += decoder.decode(chunk, { stream: true })
                },
                close() {
                    resolve()
                },
                error(_socket, error) {
                    reject(error)
                },
                connectError(_socket, error) {
                    reject(error)
                },
            },
        }).catch(reject)
    })

    const response = JSON.parse(raw + decoder.decode()) as { key?: string; error?: string }

    if (!response.key) {
        throw new Error(response.error ?? 'Key broker returned no key')
    }

    return response.key
}
