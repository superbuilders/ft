import { existsSync } from 'node:fs'
import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { PI_SHA256, PI_VERSION } from '../../../src/constants'
import { digest } from './build'
import { descendants } from './harness'
import { check, checkpoint, command, PrerequisiteError, signalGroup, start } from './processes'

import type { Context } from './types'

/**
 * Interrupt the real runtime installer after tar has extracted bytes into staging.
 * The tar fixture announces its PID then blocks without launching another child.
 * @param context - owned scratch cache
 * @param directory - offline pinned Pi archive directory
 * @returns completion of hard-kill and recovery assertions
 */
export async function killExtract(context: Context, directory: string): Promise<void> {
    const asset = `pi-${context.build.target}.tar.gz`
    const archive = join(directory, asset)

    if (!existsSync(archive)) {
        throw new PrerequisiteError(`Missing offline Pi archive: ${archive}`)
    }

    if ((await digest(archive)) !== PI_SHA256[context.build.target]) {
        throw new PrerequisiteError('Pi fixture digest mismatch')
    }

    const server = Bun.serve({
        hostname: '127.0.0.1',
        port: 0,
        fetch: () => new Response(Bun.file(archive)),
    })
    const root = join(context.directory, 'extract-cache')
    const final = join(root, 'pi', PI_VERSION)
    const ready = join(context.directory, 'extract.ready')
    const worker = join(context.directory, 'installer.ts')
    const located = await command(['sh', '-c', 'command -v tar'])
    const tar = located.stdout.trim()

    await mkdir(join(context.directory, 'bin'), { recursive: true })
    await writeFile(
        join(context.directory, 'bin', 'tar'),
        `#!/bin/sh
if [ "\${1:-}" = -xzf ] && [ "\${LAB_EXTRACT_CHECKPOINT:-}" != '' ]; then
    entry=$('${tar}' -tzf "$2" | sed -n '/\\/pi$/p')
    '${tar}' "$@" "$entry" || exit $?
    printf '%s\\n' "$$" > "$LAB_EXTRACT_CHECKPOINT"
    while :; do :; done
fi
exec '${tar}' "$@"
`,
        { mode: 0o755 },
    )
    await writeFile(
        worker,
        `import { installArchive } from ${JSON.stringify(resolve('src/install.ts'))};
await installArchive(${JSON.stringify(root)}, ${JSON.stringify({ name: `pi-${PI_VERSION}`, finalPath: final, url: `http://127.0.0.1:${server.port}/${asset}`, sha256: PI_SHA256[context.build.target], binary: 'pi', version: PI_VERSION })});
`,
    )

    try {
        const child = start(context, [process.execPath, worker], context.project, {
            ...context.env,
            BUN_OPTIONS: '',
            LAB_EXTRACT_CHECKPOINT: ready,
        })

        await checkpoint(() => existsSync(ready))
        await descendants(context, child.pid)
        check(context.result, 'checkpoint', true, existsSync(ready))
        signalGroup(child.pid, 'SIGKILL')
        await child.result
        check(context.result, 'not-published', false, existsSync(final))

        const rerun = await start(context, [process.execPath, worker], context.project, {
            ...context.env,
            BUN_OPTIONS: '',
        }).result

        check(context.result, 'recovered', 0, rerun.code)

        const reference = join(context.directory, 'reference')

        await mkdir(reference)
        await command([tar, '-xzf', archive, '-C', reference, '--strip-components=1'])
        check(
            context.result,
            'final-digest',
            await digest(join(reference, 'pi')),
            existsSync(join(final, 'pi')) ? await digest(join(final, 'pi')) : null,
        )

        const expected = await Array.fromAsync(
            new Bun.Glob('**/*').scan({ cwd: reference, onlyFiles: true }),
        )
        const observed = existsSync(final)
            ? await Array.fromAsync(new Bun.Glob('**/*').scan({ cwd: final, onlyFiles: true }))
            : []
        const matches = await Promise.all(
            expected.map(
                async path =>
                    existsSync(join(final, path)) &&
                    (await digest(join(reference, path))) === (await digest(join(final, path))),
            ),
        )
        const matching = expected.length === observed.length && matches.every(Boolean)

        check(
            context.result,
            'no-partial-final',
            { matching: true, versions: [PI_VERSION] },
            { matching, versions: await readdir(join(root, 'pi')).catch(() => []) },
        )
    } finally {
        await server.stop(true)
    }
}
