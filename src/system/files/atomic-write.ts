import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/**
 * Publish a complete file by a same-directory rename.
 * @param path - output destination
 * @param text - full contents
 * @returns completion of atomic publication
 */
export async function atomicWrite(path: string, text: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true })

    const temporary = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`

    try {
        await writeFile(temporary, text, { mode: 0o600 })
        await rename(temporary, path)
    } finally {
        await rm(temporary, { force: true })
    }
}
