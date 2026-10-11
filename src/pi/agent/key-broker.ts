import { getKey } from '../../project/key/key'
import { KEY_REQUEST } from './constants'

import type { ResolvedConfig } from '../../project/config/types'

/**
 * Serve a credential over a private run-local socket, keeping caller credentials out of Pi's environment.
 * The client speaks first and the server answers only then: Bun's client reports a connect as refused
 * when the server writes and hangs up before the client has finished opening its end.
 * @param path - socket inside the mode-0700 run directory
 * @param config - caller key configuration
 * @param signal - run cancellation
 * @returns asynchronous server cleanup
 */
export function serveKey(
    path: string,
    config: ResolvedConfig,
    signal: AbortSignal,
): () => Promise<void> {
    let key: Promise<string> | undefined
    const server = Bun.listen({
        unix: path,
        socket: {
            open() {},
            data(socket) {
                key ??= getKey(config, signal)
                void key.then(
                    value => socket.end(JSON.stringify({ key: value })),
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
 * @returns the brokered credential
 */
export async function brokerKey(path: string): Promise<string> {
    const decoder = new TextDecoder()
    let raw = ''

    await new Promise<void>((resolve, reject) => {
        Bun.connect({
            unix: path,
            socket: {
                open(socket) {
                    socket.write(KEY_REQUEST)
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
