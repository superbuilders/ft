import { writeFile } from 'node:fs/promises'
import { hostname } from 'node:os'
import { join } from 'node:path'

import { DEFAULT_ROLE } from '../../models/constants'
import { atomicWrite } from '../../system/files/atomic-write'
import { RUN_FILES, STATUS_INTERVAL_MS } from './constants'
import { briefTitle, createRun, emptyProgress, writeRequest, writeStatus } from './store'

import type { OpenRun, Status } from './types'

/**
 * Create a run with everything a reader needs before it starts: its folder, the brief, the
 * request, and a first status that says it is running.
 * @param root - project root
 * @param input - what the run is and how it was asked for
 * @returns the new run's first status
 */
export async function openRun(root: string, input: OpenRun): Promise<Status> {
    const { brief, request, selected } = input
    const { id, dir } = await createRun(root, input.name)
    const now = new Date().toISOString()
    const status: Status = {
        schemaVersion: 2,
        id,
        dir,
        title: briefTitle(brief),
        outcome: 'running',
        piVersion: input.piVersion,
        role: request.model ? null : (request.role ?? DEFAULT_ROLE),
        provider: selected.provider,
        model: selected.model,
        thinking: selected.thinking ?? null,
        profile: request.profile,
        cwd: request.cwd,
        pid: null,
        host: hostname(),
        startedAt: now,
        updatedAt: now,
        piExitCode: null,
        signal: null,
        settled: false,
        stopReason: null,
        retryCount: 0,
        compactionCount: 0,
        toolErrorCount: 0,
        durationMs: 0,
        error: null,
        answer: null,
        partial: null,
        ...emptyProgress(),
    }

    await Promise.all([
        writeFile(join(dir, RUN_FILES.brief), brief, { mode: 0o600 }),
        writeRequest(dir, request),
    ])
    await writeStatus(status)

    return status
}

/**
 * Publish status changes at most once per interval, and on demand.
 * @param status - the live status
 * @returns a nudge for each change and a flush for the end
 */
export function publisher(status: Status): { touch: () => void; flush: () => Promise<void> } {
    let timer: ReturnType<typeof setTimeout> | undefined
    let writing = Promise.resolve()

    /**
     * Queue one write behind any in flight, so writes never interleave.
     * @returns the queued write
     */
    function write(): Promise<void> {
        status.durationMs = Date.now() - Date.parse(status.startedAt)
        writing = writing.then(() => writeStatus(status)).catch(() => {})

        return writing
    }

    return {
        touch() {
            timer ??= setTimeout(() => {
                timer = undefined
                void write()
            }, STATUS_INTERVAL_MS)
        },
        async flush() {
            clearTimeout(timer)
            timer = undefined
            await write()
        },
    }
}

/**
 * Keep a decided run's answer (and copy it to --out), or the last thing a failed run's model
 * said. Publication is atomic, so a reader never sees half an answer.
 * @param status - status with its outcome decided, updated with the path written
 * @param text - the model's final answer and its last text that said anything
 * @param text.answer - the final answer, kept on success
 * @param text.partial - the last text that said anything, kept after a failure
 * @param out - the caller's --out path, if any
 * @returns completion
 */
export async function saveText(
    status: Status,
    text: { answer: string; partial: string },
    out: string | undefined,
): Promise<void> {
    if (status.outcome === 'success') {
        const answer = join(status.dir, RUN_FILES.answer)

        await atomicWrite(answer, text.answer)

        if (out) {
            await atomicWrite(out, text.answer)
        }

        status.answer = answer
    } else if (text.partial.trim()) {
        const partial = join(status.dir, RUN_FILES.partial)

        await atomicWrite(partial, text.partial)
        status.partial = partial
    }
}
