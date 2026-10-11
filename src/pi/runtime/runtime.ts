import { join } from 'node:path'

import { platformTarget } from '../../system/host/host'
import { installArchive } from '../../system/install/install'
import { PI_SHA256, PI_VERSION, TOOL_RELEASES } from './constants'

/**
 * Provision Pi and both pinned search tools.
 * @param root - shared cache root
 * @param signal - run cancellation
 * @returns executable and PATH directories
 */
export async function installRuntime(
    root: string,
    signal: AbortSignal,
): Promise<{ pi: string; toolDirs: string[] }> {
    const target = platformTarget()
    const pi = await installArchive(
        root,
        {
            name: `pi-${PI_VERSION}`,
            finalPath: join(root, 'pi', PI_VERSION),
            url: `https://github.com/earendil-works/pi/releases/download/v${PI_VERSION}/pi-${target}.tar.gz`,
            sha256: PI_SHA256[target],
            binary: 'pi',
            version: PI_VERSION,
        },
        signal,
    )
    const toolDirs: string[] = []

    for (const name of ['rg', 'fd'] as const) {
        const release = TOOL_RELEASES[name]
        const asset = release.targets[target]
        const finalPath = join(root, 'tools', `${name}-${release.version}`)

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
