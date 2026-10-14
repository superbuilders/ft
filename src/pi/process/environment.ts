import { delimiter } from 'node:path'

/**
 * Remove ambient Pi controls, provider credentials and the launcher's config handoff before exposing
 * the environment to tools. A delegate that inherited FT_CONFIG would point its own ft calls, and
 * the repository's tests, at this run's config.
 * @param caller - original environment
 * @param keyEnvs - every configured provider's credential variable
 * @returns sanitized copy
 */
export function filterEnvironment(
    caller: NodeJS.ProcessEnv,
    keyEnvs: readonly string[],
): NodeJS.ProcessEnv {
    return Object.fromEntries(
        Object.entries(caller).filter(
            ([name]) =>
                !name.startsWith('PI_') &&
                name !== 'FT_CONFIG' &&
                !keyEnvs.includes(name) &&
                !/(?:API_KEY|AUTH_TOKEN|OAUTH_TOKEN|ACCESS_TOKEN|SECRET|SECRET_ACCESS_KEY|SESSION_TOKEN|BEARER_TOKEN|GITHUB_TOKEN)$/.test(
                    name,
                ) &&
                !/^(?:AWS_(?:ACCESS_KEY_ID|PROFILE|SHARED_CREDENTIALS_FILE|CONFIG_FILE|WEB_IDENTITY_TOKEN_FILE|CONTAINER_CREDENTIALS_.*)|GOOGLE_APPLICATION_CREDENTIALS|ANTHROPIC_(?:IDENTITY_TOKEN_FILE|FEDERATION_RULE_ID|ORGANIZATION_ID)|HF_TOKEN|GH_TOKEN)$/.test(
                    name,
                ),
        ),
    )
}

/**
 * Construct Pi's explicit private runtime environment.
 * @param caller - sanitized caller environment
 * @param agent - private agent directory
 * @param tmp - private temporary directory
 * @param toolDirs - pinned tools placed first on PATH
 * @returns Pi process environment
 */
export function piEnvironment(
    caller: NodeJS.ProcessEnv,
    agent: string,
    tmp: string,
    toolDirs: string[],
): NodeJS.ProcessEnv {
    return {
        ...caller,
        PI_CODING_AGENT_DIR: agent,
        PI_OFFLINE: '1',
        PI_TELEMETRY: '0',
        PI_SKIP_VERSION_CHECK: '1',
        JITI_FS_CACHE: 'false',
        TMPDIR: tmp,
        PATH: [...toolDirs, caller.PATH ?? '/usr/bin:/bin'].join(delimiter),
    }
}
