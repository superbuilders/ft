/** A harness closing its terminal sends SIGHUP; treat it like Ctrl-C so Pi and its tools are stopped. */
export const CANCEL_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const
