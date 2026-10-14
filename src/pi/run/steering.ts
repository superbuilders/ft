import { appendFile } from 'node:fs/promises'

import { messageText } from '../events/progress'
import { STEER_ID_PREFIX, STEER_MAX_CHARS } from './constants'

import type { PiControl } from '../process/types'
import type { SteerReceipt, SteerRecord, SteerState } from './types'

/**
 * One steering message as the run tracks it.
 */
interface Steer {
    /** Its number in this run, from 1. */
    id: number
    /** Exactly what the caller sent; Pi delivers it unchanged as a user message. */
    message: string
    /** Where it stands. */
    state: SteerState
    /** Answers the waiting `ft steer` once Pi acknowledges, or the run ends first. */
    reply?: (receipt: SteerReceipt) => void
}

/**
 * The run's steering, as the runner holds it.
 */
export interface Steering {
    /** What spawn wires to Pi: the stdin writer in, every record out. */
    control: PiControl

    /**
     * Send one message to Pi and wait for Pi to queue it.
     * @param message - the caller's text
     * @returns queued or delivered, or refused or undelivered with a reason
     */
    submit(message: string): Promise<SteerReceipt>

    /**
     * Stop admitting steers; any Pi has not delivered stay undelivered.
     * @param reason - why the run stopped taking them
     * @returns once every record is on disk
     */
    close(reason: string): Promise<void>

    /**
     * How many steers reached the model and how many did not, for the final status.
     * @returns delivered and undelivered counts
     */
    counts(): { delivered: number; undelivered: number }
}

/**
 * Track a run's steering messages from `ft steer` to the model, recording each change in the run's
 * steers.jsonl. Pi delivers steers after the current tool round, in the order sent; delivery shows
 * as the user message carrying the same text. Admission closes when Pi settles.
 * @param log - path of the run's steers.jsonl
 * @returns the run's steering
 */
export function createSteering(log: string): Steering {
    const steers: Steer[] = []
    let write: ((line: string) => void) | undefined
    let open = true
    let records = Promise.resolve()

    /**
     * Move a steer to a new state, record it, and answer its caller if one is still waiting.
     * @param steer - the steer
     * @param state - its new state
     * @param reason - why, for refused and undelivered
     * @returns nothing
     */
    function move(steer: Steer, state: SteerState, reason?: string): void {
        steer.state = state

        const record: SteerRecord = {
            id: steer.id,
            at: new Date().toISOString(),
            state,
            ...(state === 'sent' ? { message: steer.message } : {}),
            ...(reason ? { reason } : {}),
        }

        records = records
            .then(() => appendFile(log, `${JSON.stringify(record)}\n`, { mode: 0o600 }))
            .catch(() => {})

        if (state !== 'sent' && steer.reply) {
            steer.reply({ id: steer.id, state, ...(reason ? { reason } : {}) })
            steer.reply = undefined
        }
    }

    /**
     * Stop taking steers and mark the ones still on their way.
     * @param reason - why the run stopped taking them
     * @returns nothing
     */
    function shut(reason: string): void {
        open = false

        for (const steer of steers) {
            if (steer.state === 'sent' || steer.state === 'queued') {
                move(steer, 'undelivered', reason)
            }
        }
    }

    return {
        control: {
            attach(writer) {
                write = writer
            },
            observe(event) {
                if (
                    event.type === 'response' &&
                    typeof event.id === 'string' &&
                    event.id.startsWith(STEER_ID_PREFIX)
                ) {
                    const steer = steers[Number(event.id.slice(STEER_ID_PREFIX.length)) - 1]

                    if (steer?.state === 'sent') {
                        if (event.success === true) {
                            move(steer, 'queued')
                        } else {
                            move(steer, 'refused', `Pi refused it: ${String(event.error)}`)
                        }
                    }
                }

                if (event.type === 'message_end') {
                    const message = (event.message ?? {}) as Record<string, unknown>
                    const text = message.role === 'user' ? messageText(message.content) : null
                    const steer =
                        text !== null &&
                        steers.find(
                            item =>
                                (item.state === 'sent' || item.state === 'queued') &&
                                item.message === text,
                        )

                    if (steer) {
                        move(steer, 'delivered')
                    }
                }

                if (event.type === 'agent_settled') {
                    shut('the run finished before the model read it')
                }
            },
        },
        submit(message) {
            if (!open || !write) {
                return Promise.resolve({ state: 'refused', reason: 'the run is not taking steers' })
            }

            if (!message.trim() || message.length > STEER_MAX_CHARS) {
                return Promise.resolve({
                    state: 'refused',
                    reason: `a steer needs 1 to ${STEER_MAX_CHARS} characters`,
                })
            }

            const steer: Steer = { id: steers.length + 1, message, state: 'sent' }
            const receipt = new Promise<SteerReceipt>(resolve => {
                steer.reply = resolve
            })

            steers.push(steer)
            move(steer, 'sent')
            write(
                `${JSON.stringify({ id: `${STEER_ID_PREFIX}${steer.id}`, type: 'steer', message })}\n`,
            )

            return receipt
        },
        async close(reason) {
            shut(reason)
            await records
        },
        counts() {
            return {
                delivered: steers.filter(steer => steer.state === 'delivered').length,
                undelivered: steers.filter(steer => steer.state === 'undelivered').length,
            }
        },
    }
}

/**
 * Serve `ft steer` on the run's private Unix socket.
 * @param socket - socket path in the run's mode-0700 scratch folder
 * @param steering - the run's steering
 * @returns stops the server
 */
export function serveSteering(socket: string, steering: Steering): () => Promise<void> {
    const server = Bun.serve({
        unix: socket,
        async fetch(request) {
            const body = (await request.json().catch(() => null)) as { message?: unknown } | null

            if (request.method !== 'POST' || typeof body?.message !== 'string') {
                return Response.json(
                    { state: 'refused', reason: 'expected a JSON body with a message' },
                    { status: 400 },
                )
            }

            return Response.json(await steering.submit(body.message))
        },
    })

    return () => server.stop(true)
}

/**
 * Send one steering message to a running run.
 * @param socket - the run's steering socket
 * @param message - the text the model should read
 * @returns the run's receipt
 */
export async function sendSteer(socket: string, message: string): Promise<SteerReceipt> {
    const response = await fetch('http://ft/steer', {
        unix: socket,
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message }),
    })

    return (await response.json()) as SteerReceipt
}
