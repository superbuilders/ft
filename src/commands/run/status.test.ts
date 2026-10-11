import { expect, it } from 'vitest'

import { exitCode } from './status'

it('maps every status outcome to the binding exit code', () => {
    expect(
        (
            [
                'success',
                'model_error',
                'runtime_error',
                'configuration_error',
                'incomplete',
                'protocol_error',
                'timeout',
                'cancelled',
            ] as const
        ).map(exitCode),
    ).toEqual([0, 1, 1, 2, 3, 3, 124, 130])
})
