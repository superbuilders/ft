import { join } from 'node:path'

import { platformTarget } from '../../system/host/host'
import { installArchive } from '../../system/install/install'
import { PI_SHA256, PI_VERSION, TOOL_RELEASES } from './constants'

/**
 * Where each pinned runtime part installs under the cache root.
 * @param root - shared cache root
 * @returns Pi's directory and each search tool's directory
 */
export function runtimePaths(root: string): {
    pi: string
    tools: Record<keyof typeof TOOL_RELEASES, string>
} {
    return {
        pi: join(root, 'pi', PI_VERSION),
        tools: {
            rg: join(root, 'tools', `rg-${TOOL_RELEASES.rg.version}`),
            fd: join(root, 'tools', `fd-${TOOL_RELEASES.fd.version}`),
        },
    }
}

/**
 * Provision Pi, and both pinned search tools when the run offers Pi tools.
 * @param root - shared cache root
 * @param searchTools - whether to provision rg and fd
 * @param signal - run cancellation
 * @returns executable and PATH directories
 */
export async function installRuntime(
    root: string,
    searchTools: boolean,
    signal: AbortSignal,
): Promise<{ pi: string; toolDirs: string[] }> {
    const target = platformTarget()
    const paths = runtimePaths(root)
    const pi = await installArchive(
        root,
        {
            name: `pi-${PI_VERSION}`,
            finalPath: paths.pi,
            url: `https://github.com/earendil-works/pi/releases/download/v${PI_VERSION}/pi-${target}.tar.gz`,
            sha256: PI_SHA256[target],
            binary: 'pi',
            version: PI_VERSION,
        },
        signal,
    )
    const toolDirs: string[] = []

    if (!searchTools) {
        return { pi, toolDirs }
    }

    for (const name of ['rg', 'fd'] as const) {
        const release = TOOL_RELEASES[name]
        const asset = release.targets[target]
        const finalPath = paths.tools[name]

        await installArchive(
            root,
            {
                name: `tool-${name}-${release.version}`,
                finalPath,
                url: `https://github.com/${release.repo}/releases/download/${release.tag}/${asset.asset}`,
                sha256: asset.sha256,
                binary: name,
                version: release.version,
            },
            signal,
        )
        toolDirs.push(finalPath)
    }

    return { pi, toolDirs }
}
