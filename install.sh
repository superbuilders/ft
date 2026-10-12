#!/bin/sh
# Private-repo install (GitHub's Contents API supports this raw media type):
# gh api repos/superbuilders/ft/contents/install.sh -H 'Accept: application/vnd.github.raw' | sh
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
command -v gh >/dev/null 2>&1 || fail 2 'gh is required; install GitHub CLI and run gh auth login'
stage=$(mktemp -d "${TMPDIR:-/tmp}/ft-install.XXXXXXXXXX") || fail 1 'cannot create staging directory'
gh auth status >"$stage/auth.stdout" 2>"$stage/auth.stderr" &
active_pid=$!
if ! wait "$active_pid"; then
    fail 2 'gh is not authenticated; run gh auth login'
fi
active_pid=

gh_call() {
    gh "$@" 2>"$stage/gh.stderr" &
    active_pid=$!
    if wait "$active_pid"; then
        active_pid=
        return 0
    else
        gh_status=$?
        active_pid=
    fi
    if [ "$gh_status" -eq 4 ] || grep -Eiq 'not logged|not authenticated|authentication|gh auth login|HTTP 401|bad credentials|GH_TOKEN' "$stage/gh.stderr"; then
        fail 2 'gh is not authenticated; run gh auth login'
    fi
    fail 1 'GitHub release download or lookup failed'
}

if [ "$#" -eq 1 ]; then
    version=${1#v}
else
    gh_call release view -R superbuilders/ft --json tagName >"$stage/release.json"
    tag=$(sed -n 's/.*"tagName"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$stage/release.json")
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
labels="Downloading ft $version|Verifying checksum|Installing to $shown_dir"
[ -f "$personal" ] || labels="$labels|Setting up your personal config"
widest_status=unchanged
old_ifs=$IFS
IFS='|'
for label in $labels; do
    [ "${#label}" -le "$width" ] || width=${#label}
done
IFS=$old_ifs
width=$((width + 3 + 1 + ${#widest_status}))

printf '\n'
rule
printf '  %sft %s%s%s\n' "$bold" "$green" "$version" "$reset"
rule

step "Downloading ft $version"
gh_call release download "v$version" -R superbuilders/ft -p ft-shim -p SHA256SUMS -D "$stage" >/dev/null
step_end done "$green"
step 'Verifying checksum'
expected=$(sed -n 's/^\([0-9a-fA-F]*\)  ft-shim$/\1/p' "$stage/SHA256SUMS")
[ "${#expected}" -eq 64 ] && printf '%s\n' "$expected" | grep -Eq '^[0-9a-fA-F]+$' ||
    fail 1 'missing or invalid ft-shim hash in release SHA256SUMS'
expected=$(printf '%s' "$expected" | tr 'A-F' 'a-f')
if command -v sha256sum >/dev/null 2>&1; then
    actual=$(sha256sum <"$stage/ft-shim") || fail 1 'SHA-256 verification failed'
elif command -v shasum >/dev/null 2>&1; then
    actual=$(shasum -a 256 <"$stage/ft-shim") || fail 1 'SHA-256 verification failed'
else
    fail 2 'sha256sum or shasum is required'
fi
actual=${actual%% *}
[ "$actual" = "$expected" ] || fail 1 'checksum mismatch for ft-shim'
step_end done "$green"

step "Installing to $shown_dir" "Installing to $cyan$shown_dir$dim"
mkdir -p "$install_dir" || fail 1 'cannot create installation directory'
install_dir=$(cd "$install_dir" && pwd -P) || fail 1 'cannot resolve installation directory'
if [ -f "$install_dir/ft" ] && cmp -s "$stage/ft-shim" "$install_dir/ft"; then
    step_end unchanged "$dim"
else
    # Stage beside the destination so replacement is atomic even across filesystems.
    replacement=$(mktemp "$install_dir/.ft-install.XXXXXXXXXX") || fail 1 'cannot stage shim replacement'
    cat "$stage/ft-shim" >"$replacement" || fail 1 'cannot copy shim'
    chmod 755 "$replacement" || fail 1 'cannot make shim executable'
    mv -f "$replacement" "$install_dir/ft" || fail 1 'cannot install shim'
    replacement=
    step_end done "$green"
fi

setup=
if [ ! -f "$personal" ]; then
    step 'Setting up your personal config'
    if "$install_dir/ft" init --user "$version" >"$stage/init.out" 2>&1; then
        step_end done "$green"
        setup=done
    else
        step_end failed "$red"
        setup=failed
    fi
fi

rule
printf '  %s✔ Installed ft %s%s\n' "$green" "$version" "$reset"
rule

case :${PATH:-}: in
    *:"$install_dir":*) ;;
    *)
        escaped=$(printf '%s' "$install_dir" | sed "s/'/'\\\\''/g")
        shell=${SHELL:-}
        case ${shell##*/} in
            zsh) rc='~/.zshrc' ;;
            bash) rc='~/.bashrc' ;;
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
case $setup in
    done) sed 's/^/  /' "$stage/init.out" ;;
    failed)
        sed 's/^/  /' "$stage/init.out" >&2
        printf '  Finish with: ft init --user\n'
        ;;
esac
printf '\n'
