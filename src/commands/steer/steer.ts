import { hostname } from 'node:os'

import { STILL_STARTING } from '../../pi/run/constants'
import { sendSteer } from '../../pi/run/steering'
import { runsFolder } from '../../project/config/config'
import { findRuns, stateOf } from '../../project/runs/store'
import { commandName } from '../../system/process/self'
import { styleFor } from '../../system/terminal/style'

import type { SteerReceipt } from '../../pi/run/types'

/**
 * Pass a message to a running run's model, which reads it after its current tool calls finish.
 * @param id - run id or unambiguous prefix
 * @param message - the text, or `-` to read it from stdin
 * @param options - output options
 * @param options.json - print the receipt as JSON
 * @returns 0 when the run queued or delivered the message, 1 otherwise
 */
export async function steer(
    id: string,
    message: string,
    options: { json?: boolean },
): Promise<number> {
    const style = styleFor(process.stdout)
    const [status] = await findRuns(runsFolder(), [id])
    let receipt: SteerReceipt

    if (!status) {
        throw new Error(`no run matches ${id}`)
    }

    const state = stateOf(status)

    if (state !== 'running') {
        receipt = { state: 'refused', reason: `the run has finished (${state})` }
    } else if (status.host !== hostname()) {
        receipt = { state: 'refused', reason: `the run is on ${status.host}; steer it there` }
    } else if (!status.control) {
        receipt = { state: 'refused', reason: STILL_STARTING }
    } else {
        const text = message === '-' ? await new Response(Bun.stdin.stream()).text() : message

        receipt = await sendSteer(status.control, text).catch(() => ({
            state: 'refused' as const,
            reason: 'the run has just finished',
        }))
    }

    const accepted = receipt.state === 'queued' || receipt.state === 'delivered'

    if (options.json) {
        process.stdout.write(`${JSON.stringify({ run: status.id, ...receipt })}\n`)
    } else if (accepted) {
        process.stdout.write(
            `${style.mark(true)}Steer ${receipt.id} ${receipt.state} for ${style.bold(status.id)}; the model reads it after its current tool calls. ${style.cyan(`${commandName()} show ${status.id}`)} shows when it lands.\n`,
        )
    } else {
        process.stdout.write(
            `${style.mark(false)}Not sent to ${style.bold(status.id)}: ${receipt.reason ?? receipt.state}\n`,
        )
    }

    return accepted ? 0 : 1
}
