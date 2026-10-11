# ft lab

One native smoke-test CLI for agent-driven iteration:

```sh
bun scripts/lab list --json
bun scripts/lab run success switch
bun scripts/lab run --all --host both
bun scripts/lab run distribution --host air
bun scripts/lab run parallel --host both
bun scripts/lab run kill-extract --keep
bun scripts/lab exec --host local --keep -- --version
bun scripts/lab exec --host air -- doctor
bun run test scripts/lab
```

If your `bun` is a version-manager shim that writes to stdout, run the lab with the real Bun binary.

`run` requires one or more exact scenario names or `--all`, which selects every
non-real scenario and never includes either real check. There is no implicit
suite. Local Bun must match package.json's `packageManager` pin; a mismatch is
an exit-2 prerequisite error naming both versions. Build preparation happens
once per host per invocation; air sync, toolchain and dependency preparation do
too. `--cold` gives the invocation a fresh build cache and each scenario a fresh
runtime cache. `--keep` retains that run's scratch directory and unmodified
ft status/events/stderr artifacts. Progress goes to stderr; stdout receives one
terminal JSON object. `list` emits one catalog object (also with `--json`). Help
is ordinary commander help, not a run result.

## Layout and identity

Both hosts use `/tmp/ft-lab`:

- `runs/<timestamp>-<random>/`: fresh mode-0700 directory, ownership metadata,
  scratch HOME, XDG cache/config/data, project, temporary files, fake gh and
  captured artifacts. Cleanup removes only this run directory.
- `cache/builds/<version>/`: immutable, native release-shaped bundles containing
  `ft-<target>`, `ft-shim`, `install.sh`, `SHA256SUMS`.
- `cache/runtime/<target>/ft/`: reusable verified Pi/rg/fd trees; scenario state
  is never shared. Parallel and distribution start with empty run-local caches.
- `cache/archives/`: previously acquired upstream runtime archives.
- `results/<run-id>.json`: terminal summaries; copied Mac results use
  `air-<run-id>.json` locally.

Build versions are `<package-version>-lab.<16-hex-input-hash>`. The input hash
covers source, lockfile, package metadata, shim/installer, Bun version, native
target, build recipe and (only for switch's B) a discriminator. Changed inputs
cannot silently select an older runner with the same package version. Darwin
builds run `codesign --force --sign -` before SHA-256 generation. Cached builds
must still match their manifest and report their baked version. Scratch
`.ft.json` pins that real native hash and uses 64 zeros for other targets.

## Offline runtime fixtures

Routine tests never authenticate, resolve a real key, or contact GitHub/the real
gateway. Acquire approved runtime assets separately, then place them under
`/tmp/ft-lab/cache/archives`, or pass `--archives <dir>`. The filenames and SHA-256
checks are exactly `src/pi/runtime/constants.ts`'s pinned upstream Pi/rg/fd artifacts. Use
`lab list` and the error result to identify a missing asset. A missing or wrong
archive is a prerequisite error, not a fake success. `kill-extract` needs only
the native Pi archive; configuration-error, switch, kill-download and non-run
exec commands need no runtime archives.

The lab serves these verified bytes on **host-local loopback**. A Bun preload
redirects only the runner's exact runtime-release fetches to that server, counts
fetches, and rejects other non-loopback fetches. It works with source and
compiled runners without adding a runtime-URL override to ft. The shim tests'
inline gh double is generalized for lab versions and serves the release folder;
it is not GitHub authentication, redirect, TLS or published-artifact evidence.
Only `real-release` checks those live boundaries.

## Scenarios

The original nine remain separately selectable: `success`, `terminal-error`,
`overflow`, `retry-success`, `research`, `timeout`, `configuration-error`,
`compiled-success`, `cancelled`. They keep the real Pi protocol and original
success/context/key-caching assertions. Cancellation waits for a model request,
not a fixed startup sleep. Fixture recording into src is intentionally removed.

- `distribution`: actual install.sh → installed shim → compiled runner → real Pi
  bash turn, empty cache then warm; exact shim/runner bytes, no warm gh calls.
- `switch`: genuine compiled A → B → A versions, retained together, two downloads.
- `parallel`: eight complete distinct tool briefs, one empty runner/runtime cache,
  correct outputs and exactly one runner/Pi/rg/fd fetch.
- `kill-download`: fake gh writes partial runner bytes and announces readiness;
  SIGKILL the installer group, then require dead-lock recovery and exact final
  runner bytes. Crash staging may remain until this run's cleanup, never at a
  final installation path.
- `kill-extract`: unchanged installArchive with real pinned Pi bytes; a tar fixture
  extracts only Pi into staging and announces readiness before completing the
  tree. SIGKILL the installer group, then require recovery and full-tree equality.
- `cancel-group`: actual Pi launches an owned long-running shell tool, which writes
  its PID checkpoint; signal the ft process group with SIGTERM and separately
  SIGHUP. Require cancelled status and no executing owned descendants before
  cleanup. Inert zombies are not counted as executing tools.

## air

`--host air` uses rsync over `ssh air` to `/tmp/ft-lab/checkout`, excluding `.git`,
`tmp`, and `node_modules`. It runs frozen-lockfile installation only when bun.lock
changes or dependencies are absent. Bun is pinned from package.json and invoked from
`/tmp/ft-lab/cache/toolchain/bun-<version>/bun`; installation HOME/cache/temp and Bun package cache
are also under `/tmp/ft-lab`. No real gh or keychain operations run remotely.
`--archives` syncs those offline fixture files into the Mac's archive cache.
The Mac builds and serves its own loopback fixtures. The coordinator copies the
result before removing only that validated run ID's directory unless `--keep`.
`--host both` runs all selected scenarios locally then on air and emits one
aggregate containing the flat, host-major per-scenario results.

All children have outer deadlines and recorded process-group ownership. The lab
kills only groups it started or captured as descendants. A hard-killed lab or a
lost SSH transport may retain the owned directory; its `owner.json` and
`owned-processes.json` are diagnostic ownership evidence, not permission to kill
arbitrary reused PIDs. No persistent named sandbox registry or broad pkill exists.

## Explicit real checks (do not run without authorization)

```sh
bun scripts/lab run real-gateway --project /path/to/project
bun scripts/lab run real-release --version 0.1.0
```

`real-gateway` is Linux-only and makes one code-lane tool round trip and one research question
through the compiled runner (90-second per-lane deadlines). It uses the supplied
project's real `.ft.json` key reference at that project's root, never resolving
or printing the key in the lab. Tools work in scratch. This is paid/live behavior.

`real-release` uses the caller's real gh configuration or explicitly supplied
credential environment, actual install.sh and an exact published version into
scratch installation/cache. No model request occurs. Both scenarios refuse
remote/both execution; credentials are never forwarded to air.

## Results and boundaries

Exit codes: **0** all comparisons passed, **1** ft/assertion failure, **2** usage or
missing prerequisite, **3** lab/build/transport/cleanup failure. An expected ft
124/130 result can pass its timeout/cancellation scenario. Ad hoc results include
child exit code, stdout, stderr and run directory; nonzero ft exit maps to lab 1.
Results include schemaVersion, runId, host, scenario, buildVersion, buildDigest,
outcome, named assertions with expected/observed values, phase milliseconds,
kept paths and cleanup outcome. Failed assertions additionally include
`childStderr: [{ argv0, code, tail }]` for every captured scenario child (last 40
stderr lines, with the dummy key replaced by `<redacted>`); real checks do not
capture credential-bearing pipes. Stderr ends each scenario with
`<host> <scenario>: passed|failed <failed assertion names>`.

Multiple results use `{ schemaVersion, host, outcome, results: [...] }`; single
scenario/single host results retain their original shape. Aggregate severity is
lab failure (3), assertion/ft failure (1), usage/prerequisite (2), pass (0), not
numeric maximum.

This is a **scratch environment, not a security sandbox**. Bash and arbitrary
`exec` commands retain the user's filesystem/network permissions. Routine fixture
commands are fixed and reviewed; isolation does not authorize chaotic/live tools
against the owner's machine.

The existing Pi 1.1.0 evidence remains relevant: terminal model errors and context
overflow can exit Pi 0; ft judges authoritative message_end/agent_settled events.
Custom-provider auth command keys are cached for a tool turn. Compiled `ft key`
uses a private Unix-socket broker rather than putting a key in files or tool env.
The whole Pi archive (WASM, themes and assets) is preserved. Bun-backed unit tests
run with `bun run test <files or dirs>`; no BUN_OPTIONS test caveat is needed.
