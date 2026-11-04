# AGENTS.md

Instructions for coding agents working in this repository.

## What ft is

`ft` is a pinned, isolated Pi runner that agent harnesses with native subagents
can call to run one brief on one model, in parallel with other runs. This is a single-package
Bun + TypeScript CLI.

## Commands

```bash
bun install                                # Install dependencies and prepare Husky
bun run typecheck                          # tsgo; allowed anywhere
bun run test <files or dirs>               # Named tests while working
bun run check                              # Hooks/CI only: typecheck, lint, format check
bun run check --pre-push                   # Also type-aware lint and knip
bun run knip                               # Compact unused-code report; config hints fail
bun src/cli.ts --version                   # Package version
bun src/cli.ts guide                       # The agent manual a consuming repo's skill points at
bun src/cli.ts init [--user]               # Set ft up in this repository, or for one person
bun src/cli.ts skill [--user]              # Add the agent skill to this repository, or one person's home
bun src/cli.ts doctor [--user]             # Check the config used here, or the personal one
bun src/cli.ts upgrade                     # Run the newest release's installer (alias: update)
bun src/cli.ts uninstall [--purge]         # Remove the launcher, cache and personal skill (and config)
bun run release <patch|minor|major|x.y.z>  # Bump, tag, push; release.yml builds and publishes
bun run dogfood [--remove]                 # Install the last commit's ft as ft-dev, beside ft
```

## Delegating

Build `ft-dev` first with `bun run dogfood`. Without access to the configured gateway, delegation is optional; tests and checks need no model credentials.

Delegate reviews and scoped changes with `ft-dev` (the `ft` skill, with every
`ft` command written `ft-dev`). `ft-dev` is a build of the last commit,
installed beside the released `ft`, so uncommitted edits never break the tool
reviewing them. After committing a change to ft, run `bun run dogfood` before
the next delegation so it uses what you built.

## Validation Workflow

Hooks gate validation: pre-commit checks lockfile sync when dependency files
are staged, then secret-scans, lints and formats staged files. Pre-push runs
typecheck, lint, format validation, type-aware lint and knip in parallel.
Tests do not run in hooks: CI runs the full suite on every pull request and
push to `main`.

`bun run check` and unscoped test runs refuse outside hooks (`FT_HOOK`) and
CI (`CI=true`), naming the narrower commands to run instead. Mid-work, use
`bun run typecheck` and the test files for the code you changed. Do not repeat
the full linter/formatter passes before committing: the staged-file hook
fixes what it can.

Push with plain `git push`, not piped through `tail`, `head` or `grep`, which
can hide the hook's last result line. Read `tmp/pre-push.log` for complete
failure output rather than rerunning the checks. The check runner returns
3 for reported check failures; the pre-push hook distinguishes that from a
runner crash.

Never invoke `tsc` directly: use `bun run typecheck` (tsgo). Never bypass git
hooks with `--no-verify` without explicit permission.

## Tests

Unit tests colocate with their sources as `*.test.ts` using Vitest. The root
`vitest.config.ts` owns this single project's include glob and shared
invariants, not per-scenario configuration. Passing tests are silent; failing
tests retain console diagnostics.

### Test-support layout and doubles

Every `tests/` tree follows one depth rule: plumbing at the root, one concern
directory for an extra Vitest project, and other files in role directories:
`fakes/`, `stubs/`, `abilities/`, `questions/`, `tasks/`. Role directories hold
files, not further subtrees. Never create `mocks/` or a `helpers.ts` kitchen
sink. A concern root holds only `env.d.ts`, `setup.ts`, `global-setup.ts`,
`actors.ts`, `harness.ts`, or `seed.ts`.

Name a double for what it is. A `Fake*` class lives in a tests-tree `fakes/`
directory or inline in a test. Each shared fake module starts with a docblock
holding exactly one of `@fake owned` (fakes this repository's code),
`@fake platform` (a standard platform API) or `@fake vendor` (a third-party
API). An owned fake also declares `@certifiedBy <repo-relative path>`, a
`*.test.ts` contract suite that runs against the real code. Platform and vendor
fakes pin the type of the interface they replace and say in prose which tests
exercise the real thing. The three generic boundary rules enforce the layout,
the tags and where fakes live.

## Architectural Principles

- DRY: one source of truth for state; derive a value once. Before adding code,
  ask whether something can be deleted instead.
- Minimize code: delete stale code immediately, with no commented-out code
  "for later". Wait until the third use for a business-logic abstraction.
- Explicit over implicit: name things for what they do; prefer explicit
  parameters to global state. Comments explain why, not what.
- Minimize rules: prefer a deterministic rule that applies everywhere over
  thresholds and judgment calls.
- Fix warnings now; refactor as you go.
- TypeScript files use `kebab-case.ts`. Types live with their owner in
  `types.ts`, exported individually; do not invent a shared package in
  anticipation of consumers.
- A `constants.ts` holds pure values: literals and as-const derivations.
  Type-only imports are the one sanctioned edge. No value imports, calls or
  constructions: these run at import time and can bind the file to one
  runtime. Runtime objects live with their consumers (e.g. `patterns.ts`);
  derived types live in the sibling `types.ts`, never in `constants.ts`.

## Source layout

`src/` is layered, and each layer imports only from the layers below it:
`cli.ts`, then `commands/` (one folder per command), `pi/` (driving Pi),
`project/` (reading the caller's project), `models/` (providers, Pi's
built-in catalog and roles), and `system/` (helpers with no ft knowledge). Sibling folders do not
import each other unless `.oxlint/boundaries/layers.json` names the edge. The
`boundaries/layer-imports` rule enforces that map. A new folder inherits the
edges of its mapped ancestors; give it its own entry only when it needs an edge
they lack. Move code down a layer rather than adding an
upward edge.

## Configuration

A project has `.ft.json` and a `.ft/` folder at its root. `.ft.json` is written
by people and agents: `providers` (a Pi built-in provider id with a `key`, or a custom endpoint
with `baseUrl`, `api`, `key` and Pi-format `models`) and `roles`
(`provider/model` plus optional thinking; `code` is the default role). A
`baseUrl` may be `{"env": "NAME"}` so a public repo need not name a private
endpoint. `.ft/lock.json` (version and checksums) and `.ft/schema.json` (the
config's JSON Schema) come from the pinned release; only `ft pin` and `ft init`
write them, and the shim reads the lock. `ft schema` prints the same schema.

Setup has two scopes with the same commands, `--user` choosing the personal one:
`ft init`, `ft pin [version]` (the newest release by default), `ft skill` and
`ft doctor`. The shim runs any `--user` command, and the machine-wide `ft upgrade`
(alias `update`) and `ft uninstall`, with the personal config and lock, skipping
the walk for a repository config, so a repository's pin never acts on the personal
setup. The repository scope is the
directory of its own `.ft.json`, else the git repository around the working
directory; the personal scope is `${XDG_CONFIG_HOME:-~/.config}/ft/`, and for
the skill, the home directory. `ft init` sets a repository up from one release:
the lock, schema, launcher `.ft/ft` (the shim, so cloners need only gh), a
starter `.ft.json`, and an `ft` package script when there is a package.json.
`ft init --user` writes the config, lock and schema only. The installer
downloads the shim, runner, schema and `SHA256SUMS` in one gh call, installs
the shim and caches the runner. Then, with `FT_RELEASE_DIR` naming that
download so nothing is fetched twice, it runs `ft init --user` when there is no
personal config, or `ft pin --user <version>` when the personal lock pins
another version. Repository pins stay as they are, and it touches nothing else. `ft upgrade`
downloads the newest release's `install.sh`, checks it against `SHA256SUMS`, and
runs it with `FT_INSTALL_DIR` set to the installed launcher's folder, so there is
one install path. `ft uninstall` removes the launcher,
cache and personal skill, and the personal config only with `--purge`. `ft pin` refuses a scope that is not set up.
`ft skill` writes the skill built into the runner (from `.agents/skills/ft/`)
at `.agents/skills/ft/SKILL.md` with a `.claude/skills/ft` link (personal scope
links only when `~/.claude` exists), so rerunning it after an upgrade refreshes
it; nothing writes the skill unasked. The
personal config is the fallback when no `.ft.json` is found walking up; a
repository's own config replaces it whole, with no merging. With the personal config, `root` (where
key commands run) is the config directory, and `workspace` (where runs and
context live) is the git repository around the working directory. Release
assets are the runners, `ft-shim`, `install.sh` and `schema.json`, all listed
in `SHA256SUMS`.

ft always prints its commands as `ft …`. How a repository runs ft (a package
script, `.ft/ft`) is the repository's fact, stated by its skill; only
`ft init`, which writes the package script, names it in its own output.

The schema in `src/project/config/schema.ts` is strict about the config,
provider, role and model fields, so a typo there fails in ft instead of being
ignored by Pi; nested Pi objects such as `compat` pass through as given. A type
test ties the model field names to pi-ai's `Model`, and pi-ai is pinned to
exactly `PI_VERSION`. A run writes only its own provider into Pi's models.json,
with a `!` command that runs this same runner's `key <provider>` as the key; Pi
accepts a key there for every provider.

## Runs

A run is an object with an id (`<name>-<4 hex>`) and a folder under
`.ft/runs/<id>/` in the caller's project: `brief.md`, `request.json`,
`status.json` (rewritten atomically while Pi works), `events.jsonl`,
`stderr.log`, then `answer.md` or `partial.md`. The folder ignores itself in
git. The run code is split by layer: `project/runs/` owns the folder (create,
publish status, save the answer), `pi/run/` drives Pi (choose the model,
launch, judge, handle signals and the deadline), and `commands/run/` checks the
request, opens the run folders, starts them and prints. `ft run` executes in the foreground; `ft start` spawns the hidden
`ft exec <dir>` detached and returns, so the run survives a harness killing or
backgrounding its shell. `watch`, `list` and `show` only read the
folder, and `stop` signals the run's process (a running status whose local
process is gone reads as `lost`; nothing rewrites it). Mistakes caught before a run exists leave no folder; they print to
stderr, or as one JSON object on stdout with `--json`.

Callers read stdout, and some harnesses keep only its tail, so every report
ends with a line restating the verdict. The agent-facing manual is
`ft guide` (`src/commands/guide/`); change it with the behavior it describes.
`.agents/skills/ft/SKILL.md` is the reference skill for consuming repositories, and
this repository's own: it points at `ft guide` rather than restating flags.

## Model adapters

When a model's traffic is something Pi 1.1.0 cannot read, add an adapter file in
`src/pi/gateway/adapters/` that rewrites its requests or responses and declares
whether the model can call tools, and register it by name in that folder's
`index.ts`. A model entry opts in with `"adapter": "<name>"`; its runs then go
through ft's loopback relay in `src/pi/gateway/`, and a tool-free adapter starts
Pi with no tools and skips installing rg and fd. Never add a separate code path
in `pi/run/` for one model.

## Scripts

Scripts run under Bun, with one commander entrypoint per `scripts/<name>/index.ts`.
Keep entrypoints and `commands/` wiring thin. Logic and colocated tests live
in the program-root `lib/`, never a `lib/` nested in `commands/`. Private
helpers stay in that program's `lib/`; `scripts/lib/` is for helpers shared
across programs/configs. Read environment variables inside functions, not
at import time or in option defaults.

## Linting & Formatting

- oxlint: `.oxlintrc.json` extends `.oxlint/base.json`, which composes spacing,
  JSDoc, generic overrides and generic boundaries. oxfmt: `.oxfmtrc.json`.
- JSDoc is required on every function declaration, class and method in
  `src/**` and `scripts/**`, exported or not (not on arrow functions or
  const/type/enum declarations). Include described `@param` and `@returns`
  tags.
- For a destructured parameter, document a meaningful object name and its
  keys (`@param event` and `@param event.locals`, not `root0`).
- Property docs are JSDoc for IDE hover; comments inside function bodies are
  multiline plain starred blocks. Type members document their constraints.
- `@stylistic/padding-line-between-statements` enforces statement spacing.
- An intentionally unconsumed export carries `@public` in its JSDoc so knip
  skips it.
- When a catch shadows an in-scope `error`, name the parameter `error_`.

## Secrets and formatting exceptions

- The commit hook rejects any staged `.env*` file except `.example` templates.
  Never print secret values.
