import { expect, it } from 'vitest'

import { filterEnvironment, piEnvironment } from './environment'

it('removes every PI override and provider or configured credential', () => {
    const caller = {
        PATH: '/bin',
        HOME: '/home/example',
        PI_MODEL: 'wrong',
        PI_UNKNOWN: 'wrong',
        OPENAI_API_KEY: 'dummy',
        ANTHROPIC_AUTH_TOKEN: 'dummy',
        GOOGLE_APPLICATION_CREDENTIALS: '/credential',
        AWS_PROFILE: 'secret-profile',
        HF_TOKEN: 'dummy',
        CUSTOM_KEY: 'dummy',
        GH_TOKEN: 'dummy',
        COPILOT_GITHUB_TOKEN: 'dummy',
    }
    const filtered = filterEnvironment(caller, 'CUSTOM_KEY')

    expect(filtered).toEqual({ PATH: '/bin', HOME: '/home/example' })

    const env = piEnvironment(filtered, '/private/agent', '/private/tmp', [
        '/tools/rg',
        '/tools/fd',
    ])

    expect(env.PATH).toBe('/tools/rg:/tools/fd:/bin')
    expect(env.PI_CODING_AGENT_DIR).toBe('/private/agent')
    expect(env.PI_OFFLINE).toBe('1')
    expect(caller.PI_MODEL).toBe('wrong')
})
