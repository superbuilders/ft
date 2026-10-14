/**
 * Something that talks to Pi while it runs, beside the brief: it may write commands to Pi's stdin
 * and sees every record Pi writes back.
 */
export interface PiControl {
    /**
     * Receive the writer for Pi's stdin once Pi has its brief; it drops lines after stdin closes.
     * @param write - sends one LF-terminated command line
     */
    attach(write: (line: string) => void): void

    /**
     * See one record from Pi, in order, after the judge has read it.
     * @param event - a parsed event or command response
     */
    observe(event: Record<string, unknown>): void
}
