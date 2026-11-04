import { existsSync } from 'node:fs'
import { cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { PI_SHA256, PI_VERSION, TOOL_RELEASES } from '../../../src/pi/runtime/constants'
import { installArchive } from '../../../src/system/install/install'
import { digest, labChecksums } from './build'
import { DUMMY_KEY } from './constants'
import { PrerequisiteError } from './processes'

import type { Archive, Build, Context } from './types'

/**
 * Describe the exact upstream assets; fixtures may never substitute a different runtime.
 * @param build - native target
 * @returns archive identities and final paths
 */
export function archives(build: Build): Archive[] {
    return [
        {
            name: 'pi',
            asset: `pi-${build.target}.tar.gz`,
            sha256: PI_SHA256[build.target],
            version: PI_VERSION,
            final: `pi/${PI_VERSION}`,
            url: `https://github.com/earendil-works/pi/releases/download/v${PI_VERSION}/pi-${build.target}.tar.gz`,
        },
        ...(['rg', 'fd'] as const).map(name => ({
            name,
            asset: TOOL_RELEASES[name].targets[build.target].asset,
            sha256: TOOL_RELEASES[name].targets[build.target].sha256,
            version: TOOL_RELEASES[name].version,
            final: `tools/${name}-${TOOL_RELEASES[name].version}`,
            url: `https://github.com/${TOOL_RELEASES[name].repo}/releases/download/${TOOL_RELEASES[name].tag}/${TOOL_RELEASES[name].targets[build.target].asset}`,
        })),
    ]
}

/**
 * Download one public upstream archive into the host's archive cache. The checksum is
 * verified before the file is renamed into place, so a partial or wrong download never
 * becomes a cached archive.
 * @param asset - pinned archive identity and its upstream URL
 * @param directory - the host's archive cache
 * @returns completion once the verified archive is cached
 */
async function fetchArchive(asset: Archive, directory: string): Promise<void> {
    const response = await fetch(asset.url)

    if (!response.ok) {
        throw new PrerequisiteError(`Cannot download ${asset.url} (HTTP ${response.status})`)
    }

    const partial = join(directory, `${asset.asset}.partial`)

    await mkdir(directory, { recursive: true })
    await Bun.write(partial, response)

    if ((await digest(partial)) !== asset.sha256) {
        await rm(partial, { force: true })
        throw new PrerequisiteError(`Downloaded archive checksum mismatch: ${asset.url}`)
    }

    await rename(partial, join(directory, asset.asset))
}

/**
 * Serve checksum-verified archives only on loopback, fetching any missing one first.
 * @param build - native build
 * @param directory - offline asset directory
 * @returns fixture server
 */
export async function archiveServer(
    build: Build,
    directory: string,
): Promise<ReturnType<typeof Bun.serve>> {
    const assets = archives(build)

    for (const asset of assets) {
        const path = join(directory, asset.asset)

        if (!existsSync(path)) {
            await fetchArchive(asset, directory)
        } else if ((await digest(path)) !== asset.sha256) {
            throw new PrerequisiteError(`Runtime archive checksum mismatch: ${path}`)
        }
    }

    return Bun.serve({
        hostname: '127.0.0.1',
        port: 0,
        fetch(request) {
            const asset = assets.find(item => new URL(request.url).pathname === `/${item.asset}`)

            return asset
                ? new Response(Bun.file(join(directory, asset.asset)))
                : new Response('Unknown asset', { status: 404 })
        },
    })
}

/**
 * Write a fetch-boundary preload for the unchanged compiled runner. All non-loopback
 * requests are refused; this is a transport fixture, not live distribution evidence.
 * @param context - owning scratch environment
 * @param port - fixture server's loopback port
 * @returns completion of preload creation
 */
export async function runtimeTransport(context: Context, port: number): Promise<void> {
    const assets = archives(context.build)
    const mapping = Object.fromEntries(
        assets.map(asset => [asset.asset, `http://127.0.0.1:${port}/${asset.asset}`]),
    )
    const path = join(context.directory, 'transport.ts')

    await writeFile(
        path,
        `import { appendFileSync } from 'node:fs';
const original = globalThis.fetch;
const mapping = ${JSON.stringify(mapping)};
globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (url.hostname === 'github.com' && url.pathname.includes('/releases/download/')) {
        const asset = url.pathname.split('/').at(-1);
        if (!mapping[asset]) throw new Error('Unexpected runtime asset');
        appendFileSync(${JSON.stringify(join(context.directory, 'runtime.calls'))}, asset + '\\n');
        return original(mapping[asset], init);
    }
    if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') throw new Error('Lab refuses non-loopback request');
    return original(input, init);
};
`,
    )
    context.env.BUN_OPTIONS = `--preload ${path}`
}

/**
 * Reuse immutable runtime trees in the lab cache, copying only owned state to a run.
 * @param context - run state
 * @param port - archive fixture port
 * @returns completion of runtime preparation
 */
export async function warmRuntime(context: Context, port: number): Promise<void> {
    const root = join(context.cache, 'runtime', context.build.target, 'ft')

    for (const asset of archives(context.build)) {
        await installArchive(root, {
            name: `${asset.name}-${asset.version}`,
            version: asset.version,
            binary: asset.name,
            sha256: asset.sha256,
            url: `http://127.0.0.1:${port}/${asset.asset}`,
            finalPath: join(root, asset.final),
        })
        await cp(join(root, asset.final), join(join(context.directory, 'xdg'), 'ft', asset.final), {
            recursive: true,
        })
    }
}

/**
 * Pin a scratch project to real native bytes and point its providers at the loopback model.
 * The custom `lab` provider stands in for a gateway; `groq` is a Pi built-in whose baseUrl the
 * config overrides, so both provider kinds reach the same fixture with the same dummy key.
 * @param context - project and environment
 * @param build - selected build
 * @param gateway - loopback endpoint, omitted for non-model commands
 * @returns completion of configuration write
 */
export async function configure(context: Context, build: Build, gateway?: string): Promise<void> {
    const baseUrl = `${gateway ?? 'http://127.0.0.1:9'}/v1`
    const key = { command: [process.execPath, 'key.ts'] }
    const lock = {
        version: build.version,
        sha256: labChecksums(build.target, build.digest),
    }
    const config = {
        providers: {
            lab: {
                key,
                baseUrl,
                api: 'openai-completions',
                compat: { supportsDeveloperRole: false },
                models: [
                    {
                        id: 'model-a',
                        reasoning: true,
                        contextWindow: 272_000,
                        maxTokens: 32_768,
                    },
                    { id: 'sonar-pro', adapter: 'sonar', contextWindow: 200_000, maxTokens: 8192 },
                ],
            },
            groq: { key, baseUrl },
        },
        roles: {
            code: { model: 'lab/model-a', thinking: 'high' },
            research: { model: 'lab/sonar-pro' },
            builtin: { model: 'groq/llama-3.1-8b-instant' },
        },
    }

    await mkdir(join(context.project, '.ft'), { recursive: true })
    await writeFile(join(context.project, '.ft/lock.json'), JSON.stringify(lock, null, 4))
    await writeFile(join(context.project, '.ft.json'), JSON.stringify(config, null, 4))
    context.release.controls.fixtures = build.directory
    context.release.controls.version = build.version
}

/**
 * Write scratch project inputs and dummy credentials for the release and model fixtures.
 * @param context - scratch project and release controls
 * @returns completion of fixture creation
 */
export async function scratchFixtures(context: Context): Promise<void> {
    await writeFile(join(context.project, 'AGENTS.md'), 'E2E_CONTEXT_SENTINEL')
    await writeFile(join(context.project, 'brief.md'), 'Use the bash tool, then answer.')
    await writeFile(
        join(context.project, 'key.ts'),
        "import { appendFileSync } from 'node:fs'; appendFileSync('key-count', '1\\n'); process.stdout.write(process.env.E2E_SECRET ?? '')\n",
    )
    context.env.E2E_SECRET = DUMMY_KEY
    context.env.OPENAI_API_KEY = 'dummy-removed'
    context.env.ANTHROPIC_AUTH_TOKEN = 'dummy-removed'
    context.env.PI_CODING_AGENT_DIR = '/must-not-be-used'
    await configure(context, context.build)
}

/**
 * Read a fixture's append-only calls; absence means no calls.
 * @param path - fixture call log
 * @returns individual calls
 */
export async function calls(path: string): Promise<string[]> {
    const text = await readFile(path, 'utf8').catch(() => '')

    return text.trim().split('\n').filter(Boolean)
}

/**
 * Read runner downloads, excluding metadata, latest lookups and storage redirects.
 * @param context - owning run and release call log
 * @returns runner asset request paths
 */
export async function runnerDownloads(context: Context): Promise<string[]> {
    const requests = await calls(join(context.directory, 'release.calls'))

    return requests.filter(path =>
        /^\/download\/v[^/]+\/ft-(?:linux|darwin)-(?:x64|arm64)$/.test(path),
    )
}

/**
 * Ensure scratch filesystem directories exist without consulting personal HOME.
 * @param directory - unique run directory
 * @returns completion of layout creation
 */
export async function layout(directory: string): Promise<void> {
    for (const name of ['home', 'xdg', 'project', 'bin', 'temp', 'config', 'data']) {
        await mkdir(join(directory, name), { recursive: true, mode: 0o700 })
    }
}
