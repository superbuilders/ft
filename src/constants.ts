export const PI_VERSION = '1.1.0'

export const TARGETS = ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64'] as const

export const PI_SHA256 = {
    'darwin-arm64': '3455b13de35c15a5893cdebc922678199e90a7ce99b06cbc23f37860e90d63c7',
    'darwin-x64': '8fdd9149ae27e7470a6a10ed8a7c0ed80738d55adec80a8d7764f6386d1e658b',
    'linux-arm64': 'f3b0cac459f9df5420e4e48b48e95d81bfab57b701dd3fe4b08fda7d11d27dab',
    'linux-x64': '3faa94666cd3849d37af320ff749407d0271b07a9b94f420c87e30866e10e289',
} as const

export const TOOL_RELEASES = {
    rg: {
        version: '15.2.0',
        repo: 'BurntSushi/ripgrep',
        tag: '15.2.0',
        targets: {
            'darwin-arm64': {
                asset: 'ripgrep-15.2.0-aarch64-apple-darwin.tar.gz',
                sha256: '3750b2e93f37e0c692657da574d7019a101c0084da05a790c83fd335bad973e4',
            },
            'darwin-x64': {
                asset: 'ripgrep-15.2.0-x86_64-apple-darwin.tar.gz',
                sha256: 'af7825fcc69a2afc7a7aea55fc9af90e26421d8f20fe59df32e233c0b8a231c1',
            },
            'linux-arm64': {
                asset: 'ripgrep-15.2.0-aarch64-unknown-linux-musl.tar.gz',
                sha256: '800b1e7206afe799dfb5a6901f23147cfaabe0e52210538100f61e86e1740915',
            },
            'linux-x64': {
                asset: 'ripgrep-15.2.0-x86_64-unknown-linux-musl.tar.gz',
                sha256: '33e15bcf1624b25cdd2a55813a47a2f95dbe126268203e76aa6a585d1e7b149c',
            },
        },
    },
    fd: {
        version: '10.5.0',
        repo: 'sharkdp/fd',
        tag: 'v10.5.0',
        targets: {
            'darwin-arm64': {
                asset: 'fd-v10.5.0-aarch64-apple-darwin.tar.gz',
                sha256: 'b67e1836c468e42e411984b56e52fa7abec08c2bd22c867398e7cc134aac5e12',
            },
            'darwin-x64': {
                asset: 'fd-v10.5.0-x86_64-apple-darwin.tar.gz',
                sha256: '7e31028c62c6955877735d0406807aa484c2a5e6f86235a59e26c29c301da590',
            },
            'linux-arm64': {
                asset: 'fd-v10.5.0-aarch64-unknown-linux-musl.tar.gz',
                sha256: 'd76c4317f7d5dba69f8a2a15856c90c777e7f0dd4e85f0de8c76de6992c374d4',
            },
            'linux-x64': {
                asset: 'fd-v10.5.0-x86_64-unknown-linux-musl.tar.gz',
                sha256: '761c72dc8e120d85b22292063be8a796e2eeb20eb3e4f38b8fa2343ccf3514a7',
            },
        },
    },
} as const

export const MODEL_CATALOG = [
    {
        id: 'claude-fable-5',
        name: 'Fable 5',
        reasoning: true,
        input: ['text'],
        contextWindow: 200_000,
        maxTokens: 32_768,
    },
    {
        id: 'claude-fable-5-1',
        name: 'Fable 5.1',
        reasoning: true,
        input: ['text'],
        contextWindow: 200_000,
        maxTokens: 32_768,
    },
    {
        id: 'claude-sonnet-5',
        name: 'Sonnet 5',
        reasoning: true,
        input: ['text'],
        contextWindow: 200_000,
        maxTokens: 32_768,
    },
    {
        id: 'gpt-5.6-luna',
        name: 'Luna',
        reasoning: true,
        input: ['text'],
        contextWindow: 272_000,
        maxTokens: 32_768,
    },
    {
        id: 'gpt-5.6-sol',
        name: 'Sol',
        reasoning: true,
        input: ['text'],
        contextWindow: 272_000,
        maxTokens: 32_768,
    },
    {
        id: 'gpt-5.6-terra',
        name: 'Terra',
        reasoning: true,
        input: ['text'],
        contextWindow: 272_000,
        maxTokens: 32_768,
    },
    {
        id: 'grok-latest',
        name: 'Grok 4.6 (latest)',
        reasoning: true,
        input: ['text'],
        contextWindow: 2_000_000,
        maxTokens: 32_768,
        thinkingLevelMap: {
            low: 'low',
            medium: 'medium',
            high: 'high',
            xhigh: 'xhigh',
            max: 'xhigh',
        },
    },
    {
        id: 'grok-build-0.1',
        name: 'Grok Build',
        reasoning: true,
        input: ['text'],
        contextWindow: 256_000,
        maxTokens: 32_768,
        thinkingLevelMap: {
            low: 'low',
            medium: 'medium',
            high: 'high',
            xhigh: 'xhigh',
            max: 'xhigh',
        },
    },
    {
        id: 'glm-5p2',
        name: 'GLM 5.2',
        reasoning: true,
        input: ['text'],
        contextWindow: 200_000,
        maxTokens: 32_768,
        thinkingLevelMap: {
            minimal: null,
            low: null,
            medium: null,
            high: 'high',
            xhigh: 'max',
            max: 'max',
        },
        compat: {
            thinkingFormat: 'zai',
        },
    },
    {
        id: 'kimi-k3',
        name: 'Kimi K3',
        reasoning: true,
        input: ['text'],
        contextWindow: 256_000,
        maxTokens: 32_768,
    },
    {
        id: 'deepseek-v4-flash-0731',
        name: 'DeepSeek V4 Flash',
        reasoning: true,
        input: ['text'],
        contextWindow: 1_000_000,
        maxTokens: 32_768,
        thinkingLevelMap: {
            minimal: null,
            low: 'low',
            medium: 'high',
            high: 'high',
            xhigh: 'high',
            max: 'max',
        },
        compat: {
            thinkingFormat: 'deepseek',
            requiresReasoningContentOnAssistantMessages: true,
        },
    },
    {
        id: 'deepseek-v4-pro-0813',
        name: 'DeepSeek V4 Pro',
        reasoning: true,
        input: ['text'],
        contextWindow: 1_000_000,
        maxTokens: 32_768,
        thinkingLevelMap: {
            minimal: null,
            low: 'low',
            medium: 'high',
            high: 'high',
            xhigh: 'high',
            max: 'max',
        },
        compat: {
            thinkingFormat: 'deepseek',
            requiresReasoningContentOnAssistantMessages: true,
        },
    },
    {
        id: 'sonar-pro',
        name: 'Sonar Pro',
        reasoning: false,
        input: ['text'],
        contextWindow: 200_000,
        maxTokens: 8192,
    },
    {
        id: 'gpt-6.1-sol',
        name: 'Sol',
        reasoning: true,
        input: ['text'],
        contextWindow: 1_050_000,
        maxTokens: 32_768,
    },
] as const

export const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const

export const DEFAULT_LANES = {
    code: { model: 'gpt-6.1-sol', thinking: 'high' },
    research: { model: 'sonar-pro' },
} as const

/** The lane a run uses when the caller names neither a lane nor a model. */
export const DEFAULT_LANE = 'code'

export const GATEWAY_URL = 'https://gateway.example.com'

export const FROZEN_SETTINGS = {
    defaultProjectTrust: 'never',
    enableInstallTelemetry: false,
    enableAnalytics: false,
    theme: 'dark',
    packages: [],
    extensions: [],
    skills: [],
    prompts: [],
    themes: [],
} as const

export const KILL_GRACE_MS = 1500
export const LOCK_POLL_MS = 200

/** A harness closing its terminal sends SIGHUP; treat it like Ctrl-C so Pi and its tools are stopped. */
export const CANCEL_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const
