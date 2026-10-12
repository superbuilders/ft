/** Markdown imported with `with { type: 'text' }`, which Bun inlines as a string. */
declare module '*.md' {
    const text: string

    export default text
}
