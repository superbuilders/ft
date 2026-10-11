# Runner verification

Run `bun scripts/e2e` to install the pinned runtime in a temporary cache, compile
an ft binary, start a loopback OpenAI-compatible server, and test source and
compiled execution. Only public GitHub release downloads and loopback model
requests occur. All credentials are dummy strings. `--record` refreshes the Pi
JSONL fixtures in `src/tests/stubs/`.

Unit tests now exercise Bun's shell and process APIs. Run Vitest with Bun's runtime:
`BUN_OPTIONS=--bun FT_HOOK=pre-commit bun run test src scripts`. The plain package
script otherwise follows Vitest's Node shebang, where `import { $ } from 'bun'`
is unavailable. Tooling configuration is unchanged.

## Pi 1.1.0 evidence

- The official v1.1.0 `SHA256SUMS` supplies all four Pi digests in
  `src/constants.ts`. Downloaded `pi-linux-x64.tar.gz` hashes to
  `3faa94666cd3849d37af320ff749407d0271b07a9b94f420c87e30866e10e289`.
  Its executable reports `1.1.0`; the installer preserves the entire archive tree.
- Ripgrep 15.2.0 and fd 10.5.0 were the latest stable GitHub releases when built.
  Exact filenames and GitHub release asset SHA-256 digests are in constants;
  Linux uses musl. Linux x64 tool downloads also pass checksum and version tests.
- The archive's `docs/cli.md` documents `-p`, `--mode json`, `--no-session`,
  `--no-approve`, `--no-extensions`, `--no-skills`, `--no-prompt-templates`,
  `--no-themes`, `--no-context-files`, `--provider`, `--model`, `--thinking`,
  and `--tools`. E2E exercises these flags with real Pi. `--no-extensions` in
  1.1.0 also disables built-in extensions.
- `--append-system-prompt` takes text **or an existing file path** and is
  repeatable. E2E uses a file and asserts the bounded context sentinel in the
  server's received system message.
- `docs/json.md` defines strict LF framing, the session header, `agent_start`,
  authoritative `message_end.message`, `agent_settled.aborted`,
  `auto_retry_start`, `compaction_start`, `summarization_retry_scheduled`, and
  `tool_execution_end.isError`. `docs/message-types.md` defines text blocks and
  assistant stop reasons. Fixtures are recorded from the real 1.1.0 binary;
  `malformed.jsonl` is a deliberate mutation of the success recording.
- `agent_end` is not final settlement; recovered retries can follow it.
  Terminal assistant errors and empty-output context overflow exit **0** in JSON
  mode. The overflow fixture contains an empty error assistant and settlement;
  ft rejects it as `model_error`, never publishing an empty answer.
- `docs/providers.md` documents `auth.json` command keys cached for the process
  lifetime. E2E proves this works with a **custom truefoundry models.json provider
  lacking apiKey**: a two-request tool run invokes the command once. Both
  `bun /absolute/src/cli.ts key` and a compiled `/absolute/ft key` work.
- Model metadata came exclusively from the permitted truefoundry `models` array.
  v1.1.0 `packages/coding-agent/src/core/model-config.ts` was checked against
  every compat and thinking-map entry. The string/null thinking maps, `zai`,
  `deepseek`, and `requiresReasoningContentOnAssistantMessages` are supported.
  **Dropped `kimi-k3.compat.deferredToolsMode: "kimi"`**: absent from 1.1.0's
  compatibility schema/transport. No other catalog changes. E2E loads the full
  catalog without schema errors.
- Pi's OpenAI transport expects the API prefix in models.json; ft treats
  gateway.baseUrl as the gateway root and appends `/v1` (research appends
  `/v1/chat/completions`).

## Isolation boundary and deliberate choices

The key subprocess cannot inherit an env-based key while Pi's tools are required
not to inherit it. A mode-0700 run directory therefore holds a private Unix socket:
Pi invokes the requested `ft key` auth command, which asks the parent runner's
in-memory broker. The parent runs the configured argv at the project root with
its original environment. No key is written to files, arguments, or Pi's
environment. Tools still run with the user's permissions; this is not a sandbox.

Pinned search executables live in the contract's separate immutable tool version
directories; both directories precede the caller PATH. They are not copied into
Pi's immutable tree. Context imports and symlinks escaping the project boundary
are rejected rather than silently loading personal instructions.

SIGINT/SIGTERM and deadline runs persist interruption status before aborting Pi,
capture Pi and descendant process groups, terminate them, allow Pi's tool
cleanup, then hard-kill those groups after 1.5 seconds. No deadline is imposed unless explicitly supplied.

Live gateway behavior and macOS/ARM execution are intentionally not tested here.
