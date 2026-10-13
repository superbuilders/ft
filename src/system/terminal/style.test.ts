import { afterEach, expect, it, vi } from 'vitest'

import { styleFor } from './style'
import { renderSummary } from './summary'

afterEach(() => {
    vi.unstubAllEnvs()
})

it.each([
    [{}, true, true],
    [{}, false, false],
    [{ NO_COLOR: '1' }, true, false],
    [{ TERM: 'dumb' }, true, false],
    [{ FORCE_COLOR: '1' }, false, true],
    [{ FORCE_COLOR: '0' }, true, true],
    [{ FORCE_COLOR: '1', NO_COLOR: '1' }, false, true],
])('styles %o on a terminal=%s: %s', (env, isTTY, on) => {
    vi.stubEnv('NO_COLOR', '')
    vi.stubEnv('FORCE_COLOR', undefined)
    vi.stubEnv('TERM', 'xterm-256color')

    for (const [name, value] of Object.entries(env)) {
        vi.stubEnv(name, value)
    }

    const style = styleFor({ isTTY })

    expect(style.on).toBe(on)
    expect(style.bold('x') === 'x').toBe(!on)
    expect(style.mark(true)).toBe(on ? `${style.green('✔')} ` : '')
})

it('prints a summary plain, backticks dropped, where styling is off', () => {
    const text = renderSummary(
        {
            done: 'Pinned ft 0.2.0 for this repository',
            rows: [['Lock', '.ft/lock.json']],
            steps: ['Check it with `ft doctor`'],
        },
        styleFor({ isTTY: false }),
    )

    expect(text).toBe(
        'Pinned ft 0.2.0 for this repository\nLock  .ft/lock.json\n\nNext:\n  1. Check it with ft doctor\n',
    )
})
