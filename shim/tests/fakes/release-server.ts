/**
 * @fake vendor
 * Substitutes GitHub's public release download URLs: `<url>/latest` redirects to
 * `<url>/tag/v<version>`, and `<url>/download/v<version>/<asset>` redirects to a storage path
 * that serves the asset, as GitHub's redirect to its asset storage does. shim/ft.test.ts, the
 * release tests and scripts/lab exercise it through real curl and fetch; the lab's opt-in
 * real-release scenario exercises the real GitHub URLs.
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'

import type { IncomingMessage, Server, ServerResponse } from 'node:http'

/**
 * What the server serves and how it misbehaves; tests change it between requests.
 */
export interface ReleaseControls {
    /**
     * Folder holding the release's assets.
     */
    fixtures: string

    /**
     * The newest release; every version's downloads serve the same assets.
     */
    version: string

    /**
     * File each request's path is appended to, one per line, when set.
     */
    calls?: string

    /**
     * Wait this long before answering a download.
     */
    delayMs?: number

    /**
     * Never answer a download, until the server closes.
     */
    block?: boolean

    /**
     * Answer every request with this HTTP status.
     */
    fail?: number

    /**
     * Send part of a download, then write this file and hold the response open.
     */
    checkpoint?: string
}

/**
 * A running release server.
 */
export interface ReleaseServer {
    /**
     * Base URL to set as FT_RELEASE_URL.
     */
    url: string

    /**
     * The controls, read on every request.
     */
    controls: ReleaseControls

    /**
     * Each request's path, in order.
     */
    requests: string[]

    /**
     * Stop serving, dropping held responses.
     */
    close: () => Promise<void>
}

/**
 * Start a release server on a free local port.
 * @param controls - initial controls
 * @returns the running server
 */
export async function releaseServer(controls: ReleaseControls): Promise<ReleaseServer> {
    const requests: string[] = []

    /**
     * Answer one request the way GitHub's release URLs do.
     * @param request - incoming request
     * @param response - its response
     * @returns completion
     */
    async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
        const path = new URL(request.url ?? '/', 'http://localhost').pathname

        requests.push(path)

        if (controls.calls) {
            appendFileSync(controls.calls, `${path}\n`)
        }

        if (controls.fail) {
            response.writeHead(controls.fail).end()

            return
        }

        if (path === '/latest') {
            response.writeHead(302, { location: `/tag/v${controls.version}` }).end()

            return
        }

        if (path === `/tag/v${controls.version}`) {
            response.writeHead(200, { 'content-type': 'text/html' }).end('<html></html>')

            return
        }

        const download = /^\/download\/(v[^/]+)\/([^/]+)$/.exec(path)

        if (download) {
            response.writeHead(302, { location: `/storage/${download[1]}/${download[2]}` }).end()

            return
        }

        const stored = /^\/storage\/v[^/]+\/([^/]+)$/.exec(path)
        const file = stored ? join(controls.fixtures, stored[1] ?? '') : ''

        if (!stored || !existsSync(file)) {
            response.writeHead(404).end('Not Found')

            return
        }

        if (controls.delayMs) {
            await new Promise(resolve => setTimeout(resolve, controls.delayMs))
        }

        /* A held response stays open until close() drops every connection. */
        if (controls.block) {
            return
        }

        const body = readFileSync(file)

        if (controls.checkpoint) {
            response.writeHead(200, { 'content-length': body.length + 1 })
            response.write(body.subarray(0, Math.floor(body.length / 2)))
            writeFileSync(controls.checkpoint, `${process.pid}\n`)

            return
        }

        response.writeHead(200, { 'content-length': body.length }).end(body)
    }

    const server: Server = createServer((request, response) => {
        void handle(request, response)
    })

    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))

    const address = server.address()
    const port = typeof address === 'object' && address ? address.port : 0

    return {
        url: `http://127.0.0.1:${port}`,
        controls,
        requests,
        close: async () => {
            server.closeAllConnections()
            await new Promise(resolve => server.close(resolve))
        },
    }
}
