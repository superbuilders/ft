import { invocation, spelled } from '../system/process/self'

/**
 * When ft runs through a package script or a launcher path, spell every printed ft command that
 * way, so an agent can paste it back. Machine output (JSON, the schema, a key) is left alone.
 * @param argv - this process's arguments
 */
export function speakTheCallersWay(argv: string[] = process.argv): void {
    const prefix = invocation()
    const machine = ['schema', 'key', 'exec'].includes(argv[2] ?? '')

    if (prefix === 'ft' || machine || argv.includes('--json')) {
        return
    }

    for (const stream of [process.stdout, process.stderr]) {
        const write = stream.write.bind(stream)

        stream.write = ((chunk: unknown, ...rest: unknown[]) =>
            Reflect.apply(write, stream, [
                typeof chunk === 'string' ? spelled(chunk, prefix) : chunk,
                ...rest,
            ])) as typeof stream.write
    }
}
