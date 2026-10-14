/**
 * @fake vendor
 * Substitutes the gh CLI's `auth status/token` and `release view/download` interface,
 * pinned to the argument vectors used by shim/ft, install.sh and release.ts (no TS API).
 * shim/ft.test.ts and scripts/lab/lib/lab.test.ts exercise the double; the lab's opt-in
 * real-release scenario exercises the real CLI against the published release assets.
 */

/**
 * Build an offline gh executable serving assets from FAKE_FIXTURES and logging to FAKE_CALLS.
 * @param options - supported release and download behavior
 * @param options.version - fallback version when FAKE_VERSION does not select a lab build
 * @param options.stdout - allow `-O -` downloads as well as destination folders
 * @param options.checkpoint - allow LAB_DOWNLOAD_CHECKPOINT to pause a partial download
 * @returns POSIX sh executable text
 */
export function fakeGh({
    version = '0.1.0',
    stdout = false,
    checkpoint = false,
}: {
    /** Default release version; FAKE_VERSION can select another build at runtime. */
    version?: string
    /** Accept gh's stdout download flag. */
    stdout?: boolean
    /** Enable the lab's interruption checkpoint. */
    checkpoint?: boolean
} = {}): string {
    return `#!/bin/sh
printf '%s\\n' "$*" >> "$FAKE_CALLS"
version="\${FAKE_VERSION:-${version}}"
if [ "$1 $2" = 'auth token' ]; then
    printf '%s\\n' 'fake-token-must-not-leak'
    echo 'fake-auth-token-stderr-must-not-leak' >&2
    exit "\${FAKE_AUTH_TOKEN_EXIT:-1}"
fi
if [ "\${FAKE_GH_FAIL:-}" = keychain ]; then
    echo 'HTTP 401: The token is invalid' >&2
    exit 1
fi
if [ "\${FAKE_GH_FAIL:-}" = auth ]; then
    echo 'To get started with GitHub CLI, please run: gh auth login' >&2
    exit 4
fi
if [ "\${FAKE_GH_FAIL:-}" = download ]; then
    echo 'HTTP 500: unavailable' >&2
    exit 1
fi
case "$1 $2" in
    'auth status') exit 0 ;;
    'release view'|'release download') command=$2 ;;
    *) echo 'unexpected gh command' >&2; exit 9 ;;
esac
shift 2
patterns=
destination=
query=no
while [ "$#" -gt 0 ]; do
    case $1 in
        -p) patterns="$patterns $2"; shift 2 ;;
        -D) destination=$2; shift 2 ;;
${stdout ? '        -O) [ "$2" = - ] || exit 9; destination=-; shift 2 ;;\n' : ''}        -R) [ "$2" = superbuilders/ft ] || exit 9; shift 2 ;;
        --json) [ "$2" = tagName ] || exit 9; shift 2 ;;
        -q) [ "$2" = .tagName ] || exit 9; query=yes; shift 2 ;;
        "v$version") shift ;;
        *) exit 9 ;;
    esac
done
if [ "\${FAKE_BLOCK:-}" = yes ]; then
    # No child process: signal tests must not leave a sleeper behind.
    while :; do :; done
fi
if [ "$command" = view ]; then
    if [ "$query" = yes ]; then
        printf 'v%s\\n' "$version"
    else
        printf '{"tagName":"v%s"}\\n' "$version"
    fi
    exit 0
fi
if [ -n "\${FAKE_DELAY:-}" ]; then sleep "$FAKE_DELAY"; fi
for asset in $patterns; do
${
    checkpoint
        ? `    if [ "\${LAB_DOWNLOAD_CHECKPOINT:-}" != '' ]; then
        printf partial > "$destination/$asset"
        printf '%s\\n' "$$" > "$LAB_DOWNLOAD_CHECKPOINT"
        while :; do :; done
    fi
`
        : ''
}    if [ "$destination" = - ]; then
        cat "$FAKE_FIXTURES/$asset" || exit 1
    else
        cat "$FAKE_FIXTURES/$asset" > "$destination/$asset" || exit 1
    fi
done
`
}
