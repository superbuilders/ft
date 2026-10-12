# AGENTS.md

Instructions for coding agents working in this repository.

## What ft is

`ft` is a pinned, isolated Pi runner that agent harnesses with native subagents
can call to run one brief on one model, in parallel with other runs. It
standardizes the team's personal `/pi-sub` workflow. This is a single-package
Bun + TypeScript CLI. `docs/plan.md` records the original design.

## Commands

```bash
bun install                         # Install dependencies and prepare Husky
bun run typecheck                   # tsgo; allowed anywhere
bun run test <files or dirs>         # Named tests while working
bun run check                       # Hooks/CI only: typecheck, lint, format check
bun run check --pre-push             # Also type-aware lint and knip
bun run knip                        # Compact unused-code report; config hints fail
bun src/cli.ts --version             # Package version
bun src/cli.ts guide                 # The agent manual a consuming repo's skill points at
bun run release <patch|minor|major|x.y.z>   # Bump, tag, push; release.yml builds and publishes
```

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

A double is named by what it is. A held `Fake*` double lives in a tests-tree
`fakes/` directory or inline in a test. Shared fake modules declare
`@fake owned | platform | vendor` in a leading module docblock. Owned fakes
also declare `@certifiedBy <repo-relative path>` pointing at a real
`*.test.ts` contract suite. Platform/vendor doubles pin their substituted
interface and name their backstop in prose. The three generic boundary rules
enforce layout, contract declaration and residency.

## Architectural Principles

- DRY: one source of truth for state; derive a value once. Before adding code,
  ask whether something can be deleted instead.
- Minimize code: delete stale code immediately, with no commented-out code
  "for later". Wait until the third use for a business-logic abstraction.
- Explicit over implicit: name things for what they do; prefer explicit
  parameters to global state. Comments explain why, not what.
- Minimize rules: prefer a deterministic rule that applies everywhere over
  thresholds and judgment calls.
- Fix warnings now; refactor as you go. After a refactor, delete dead code,
  unused imports and orphaned files.
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
built-in catalog and lanes), and `system/` (helpers with no ft knowledge). Sibling folders do not
import each other unless `.oxlint/boundaries/layers.json` names the edge. The
`boundaries/layer-imports` rule enforces that map; a new folder needs an
entry before its files lint. Move code down a layer rather than adding an
upward edge.

## Configuration

A project has `.ft.json` and a `.ft/` folder at its root. `.ft.json` is written
by people and agents: `providers` (a Pi built-in provider id with a `key`, or a custom endpoint
with `baseUrl`, `api`, `key` and Pi-format `models`) and `lanes`
(`provider/model` plus optional thinking; `code` is the default lane). A
`baseUrl` may be `{"env": "NAME"}` so a public repo need not name a private
endpoint. `.ft/lock.json` (version and checksums) and `.ft/schema.json` (the
config's JSON Schema) come from the pinned release; only `ft pin` writes them,
and the shim reads the lock. `ft schema` prints the same schema.

The schema in `src/project/config/schema.ts` is strict: every field, Pi's
included, is named, so a typo fails in ft instead of being ignored by Pi. A type
test ties the model field names to pi-ai's `Model`, and pi-ai is pinned to
exactly `PI_VERSION`. A run writes only its own provider into Pi's models.json,
with `!ft key <provider>` as the key; Pi accepts a key there for every provider.

## Runs

A run is an object with an id (`<name>-<4 hex>`) and a folder under
`.ft/runs/<id>/` in the caller's project: `brief.md`, `request.json`,
`status.json` (rewritten atomically while Pi works), `events.jsonl`,
`stderr.log`, then `answer.md` or `partial.md`. The folder ignores itself in
git. The run code is split by layer: `project/runs/` owns the folder (create,
publish status, save the answer), `pi/run/` drives Pi (choose the model,
launch, judge, handle signals and the deadline), and `commands/run/` only
reads the command line and prints. `ft run` executes in the foreground; `ft start` spawns the hidden
`ft exec <dir>` detached and returns, so the run survives a harness killing or
backgrounding its shell. `watch`, `list`, `show` and `stop` only read the
folder (a running status whose process is gone reads as `lost`; nothing
rewrites it). Mistakes caught before a run exists print to stderr and leave no
folder.

Callers read stdout, and some harnesses keep only its tail, so every report
ends with a line restating the verdict. The agent-facing manual is
`ft guide` (`src/commands/guide/`); change it with the behavior it describes.
`skill/ft/SKILL.md` is the reference skill for consuming repositories: it
points at `ft guide` rather than restating flags.

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
at import time or in option defaults. Use `types.ts` / `constants.ts`
kind-files, and JSDoc on exported functions.

## Linting & Formatting

- oxlint: `.oxlintrc.json` extends `.oxlint/base.json`, which composes spacing,
  JSDoc, generic overrides and generic boundaries. oxfmt: `.oxfmtrc.json`.
- JSDoc is required on exported functions, classes and methods in `src/**`
  and `scripts/**`, not on const/interface/type/enum declarations. Include
  described `@param` and `@returns` tags.
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
- `docs/plan.md` is excluded from formatting so the handoff stays unchanged.
