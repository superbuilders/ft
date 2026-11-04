#!/bin/sh
# Install the newest release:
# curl -fsSL https://github.com/superbuilders/ft/releases/latest/download/install.sh | sh
set -u
umask 077

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
    dim=$(printf '\033[2m') bold=$(printf '\033[1m') green=$(printf '\033[32m')
    red=$(printf '\033[31m') cyan=$(printf '\033[2;36m') reset=$(printf '\033[0m')
else
    dim= bold= green= red= cyan= reset=
fi
width=0
open_step=

# A step prints its label now and its status when it ends, right-aligned to the widest label.
# The optional second argument is the label as shown, with color inside it.
step() {
    step_label="$1..."
    printf '  %s%s...%s' "$dim" "${2:-$1}" "$reset"
    open_step=yes
}
step_end() {
    pad=$((width - ${#step_label} - ${#1}))
    [ "$pad" -ge 1 ] || pad=1
    printf "%${pad}s%s%s%s\n" '' "$2" "$1" "$reset"
    open_step=
}
rule() {
    line=
    while [ "${#line}" -lt "$width" ]; do line="$line-"; done
    printf '  %s%s%s\n' "$dim" "$(printf '%s' "$line" | sed 's/-/─/g')" "$reset"
}
fail() {
    [ -z "$open_step" ] || step_end failed "$red"
    printf 'ft install: %s\n' "$2" >&2
    exit "$1"
}

stage=
active_pid=
replacement=
cleanup() {
    if [ -n "$active_pid" ]; then
        kill "$active_pid" 2>/dev/null || :
    fi
    [ -z "$replacement" ] || rm -f "$replacement"
    [ -z "$stage" ] || rm -rf "$stage"
    return 0
}
trap cleanup 0
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

[ "$#" -le 1 ] || fail 2 'usage: install.sh [version]'
[ -n "${HOME:-}" ] || fail 2 'HOME is not set (ft installs under your home directory)'
case $(uname -s) in
    Linux) os=linux ;;
    Darwin) os=darwin ;;
    *) fail 2 'unsupported platform (expected Linux or Darwin)' ;;
esac
case $(uname -m) in
    arm64|aarch64) arch=arm64 ;;
    x86_64|amd64) arch=x64 ;;
    *) fail 2 'unsupported platform architecture (expected arm64 or x64)' ;;
esac
runner_asset=ft-$os-$arch
command -v curl >/dev/null 2>&1 || fail 2 'curl is required to download ft releases'
stage=$(mktemp -d "${TMPDIR:-/tmp}/ft-install.XXXXXXXXXX") || fail 1 'cannot create staging directory'
# FT_RELEASE_URL points at a mirror or fork with GitHub's release URL layout.
release_url=${FT_RELEASE_URL:-https://github.com/superbuilders/ft/releases}
release_url=${release_url%/}

# Fetch a release URL with curl; the extra arguments say where its output goes.
release_get() {
    url=$release_url/$1
    shift
    # wait is interruptible by traps, unlike a foreground external command.
    curl -fsSL "$@" "$url" 2>"$stage/curl.stderr" &
    active_pid=$!
    if wait "$active_pid"; then
        active_pid=
        return 0
    fi
    active_pid=
    reason=$(sed -n '$s/^curl: ([0-9]*) //p' "$stage/curl.stderr")
    fail 1 "cannot download $url${reason:+ ($reason)}"
}

if [ "$#" -eq 1 ]; then
    version=${1#v}
else
    # The latest URL redirects to the newest release's tag page; the tag is its last segment.
    release_get latest -I -o /dev/null -w '%{url_effective}' >"$stage/tag"
    tag=$(cat "$stage/tag")
    tag=${tag##*/}
    case $tag in
        v*) version=${tag#v} ;;
        *) fail 2 'latest release has an invalid tag' ;;
    esac
fi
printf '%s\n' "$version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$' ||
    fail 2 'invalid release version'
install_dir=${FT_INSTALL_DIR:-$HOME/.local/bin}
shown_dir=$install_dir
case $install_dir in
    "$HOME"/*) shown_dir="~${install_dir#"$HOME"}" ;;
esac
personal=${XDG_CONFIG_HOME:-$HOME/.config}/ft/.ft.json
cache=${XDG_CACHE_HOME:-$HOME/.cache}/ft
download_label="Downloading ft $version"
verify_label='Verifying checksums'
install_label="Installing to $shown_dir"
setup_label='Setting up your personal config'
repin_label='Updating your personal config'
widest_status=unchanged
for label in "$download_label" "$verify_label" "$install_label" "$setup_label" "$repin_label"; do
    [ "${#label}" -le "$width" ] || width=${#label}
done
width=$((width + 3 + 1 + ${#widest_status}))
readme=https://github.com/superbuilders/ft#readme
[ "${#readme}" -le "$width" ] || width=${#readme}

printf '\n'
rule
printf '  %sft %s%s%s\n' "$bold" "$green" "$version" "$reset"
rule

step "$download_label"
for asset in ft-shim SHA256SUMS "$runner_asset" schema.json; do
    release_get "download/v$version/$asset" -o "$stage/$asset"
done
step_end done "$green"

if command -v sha256sum >/dev/null 2>&1; then
    hasher=sha256sum
elif command -v shasum >/dev/null 2>&1; then
    hasher='shasum -a 256'
else
    fail 2 'sha256sum or shasum is required'
fi
sha256_of() {
    digest=$($hasher <"$1") || return 1
    printf '%s\n' "${digest%% *}"
}
# Check a downloaded asset against SHA256SUMS, leaving its checksum in listed.
verify() {
    listed=$(sed -n "s/^\([0-9a-fA-F]*\)  $1\$/\1/p" "$stage/SHA256SUMS")
    [ "${#listed}" -eq 64 ] && printf '%s\n' "$listed" | grep -Eq '^[0-9a-fA-F]+$' ||
        fail 1 "missing or invalid $1 hash in release SHA256SUMS"
    listed=$(printf '%s' "$listed" | tr 'A-F' 'a-f')
    actual=$(sha256_of "$stage/$1") || fail 1 'SHA-256 verification failed'
    [ "$actual" = "$listed" ] || fail 1 "checksum mismatch for $1"
}

step "$verify_label"
verify ft-shim
verify schema.json
verify "$runner_asset"
runner_sha=$listed
step_end done "$green"

step "$install_label" "Installing to $cyan$shown_dir$dim"
changed=no
mkdir -p "$install_dir" || fail 1 'cannot create installation directory'
install_dir=$(cd "$install_dir" && pwd -P) || fail 1 'cannot resolve installation directory'
if ! { [ -f "$install_dir/ft" ] && cmp -s "$stage/ft-shim" "$install_dir/ft"; }; then
    # Stage beside the destination so replacement is atomic even across filesystems.
    replacement=$(mktemp "$install_dir/.ft-install.XXXXXXXXXX") || fail 1 'cannot prepare the launcher'
    cat "$stage/ft-shim" >"$replacement" || fail 1 'cannot copy the launcher'
    chmod 755 "$replacement" || fail 1 'cannot make the launcher executable'
    mv -f "$replacement" "$install_dir/ft" || fail 1 'cannot install the launcher'
    replacement=
    changed=yes
fi
# Cache the runner where the shim looks for it, so ft never downloads it a second time.
runner=$cache/runner/$version/$runner_sha/ft
if [ ! -f "$runner" ] || [ "$(sha256_of "$runner")" != "$runner_sha" ]; then
    (umask 077 && mkdir -p "$cache/runner/$version" "$cache/staging") || fail 1 'cannot create cache directories'
    chmod +x "$stage/$runner_asset" || fail 1 'cannot make runner executable'
    [ "$("$stage/$runner_asset" --version 2>/dev/null)" = "$version" ] || fail 1 'runner version check failed'
    published=$(mktemp -d "$cache/staging/XXXXXXXXXX") || fail 1 'cannot create staging directory'
    mv "$stage/$runner_asset" "$published/ft" || fail 1 'cannot prepare runner'
    rm -rf "${runner%/ft}" || fail 1 'cannot replace cached runner'
    mv "$published" "${runner%/ft}" || fail 1 'cannot publish runner'
    changed=yes
fi
if [ "$changed" = yes ]; then
    step_end done "$green"
else
    step_end unchanged "$dim"
fi

# Running the installer asks for this version, so the personal pin follows it; repository pins do not.
setup=
finish=
pinned=$(sed -n 's/^[[:space:]]*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "${personal%/*}/.ft/lock.json" 2>/dev/null)
if [ ! -f "$personal" ]; then
    step "$setup_label"
    finish='ft init --user'
    set -- init --user "$version"
elif [ "$pinned" != "$version" ]; then
    step "$repin_label"
    finish="ft pin --user $version"
    set -- pin --user "$version"
fi
if [ -n "$finish" ]; then
    if FT_RELEASE_DIR=$stage "$runner" "$@" >"$stage/init.out" 2>&1; then
        step_end done "$green"
        setup=done
    else
        step_end failed "$red"
        setup=failed
    fi
fi

rule
if [ "$setup" = failed ]; then
    printf '  %s✔ Installed ft %s%s (one step left, below)\n' "$green" "$version" "$reset"
else
    printf '  %s✔ Installed ft %s%s\n' "$green" "$version" "$reset"
fi
rule
printf '  %s%s%s\n' "$cyan" "$readme" "$reset"
rule

case :${PATH:-}: in
    *:"$install_dir":*) ;;
    *)
        escaped=$(printf '%s' "$install_dir" | sed "s/'/'\\\\''/g")
        shell=${SHELL:-}
        case ${shell##*/} in
            zsh) rc='~/.zshrc' ;;
            bash)
                # macOS terminals start login shells, which read ~/.bash_profile, not ~/.bashrc.
                rc='~/.bashrc'
                [ "$(uname -s)" != Darwin ] || rc='~/.bash_profile'
                ;;
            fish) rc='~/.config/fish/config.fish' ;;
            *) rc='~/.profile' ;;
        esac
        printf '  %s%s is not on your PATH. Add this line to %s, then open a new terminal:%s\n' "$dim" "$shown_dir" "$rc" "$reset"
        if [ "$rc" = '~/.config/fish/config.fish' ]; then
            printf "  fish_add_path '%s'\n" "$escaped"
        else
            printf "  export PATH='%s':\"\$PATH\"\n" "$escaped"
        fi
        ;;
esac
if [ "$setup" = failed ]; then
    sed 's/^/  /' "$stage/init.out" >&2
    printf '  Finish with: %s\n' "$finish"
fi
printf '\n'
[ "$setup" != failed ] || exit 1
