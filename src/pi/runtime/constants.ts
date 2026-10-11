export const PI_VERSION = '1.1.0'

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
