# AGENTS.md

Instructions for coding agents working in this repository. Keep the applicable
engineering conventions in sync with playcademy-arcade.

## What ft is

`ft` is a pinned, isolated Pi runner that agent harnesses with native subagents
can call to run one brief on one model, in parallel with other runs. It
standardizes the team's personal `/pi-sub` workflow. This is a single-package
Bun + TypeScript CLI; the current scaffold implements only `ft --version`, not
the runner. `docs/plan.md` describes the future build.

## Commands

```bash
bun install                         # Install dependencies and prepare Husky
bun run typecheck                   # tsgo; allowed anywhere
bun run test <files or dirs>         # Named tests while working
bun run check                       # Hooks/CI only: typecheck, lint, format check
bun run check --pre-push             # Also type-aware lint and knip
bun run knip                        # Compact unused-code report; config hints fail
bun src/cli.ts --version             # Package version
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

## Tooling sync contract

Keep in sync with playcademy-arcade at
`/home/hbauer/work/clones/playcademy-arcade-linear`, adapting only for this
single package. Ported comment-capable configs/modules carry a sync note.
The synced JSON files without comments are `package.json`, `.oxlintrc.json`,
`.oxfmtrc.json`, `tsconfig.json`, `knip.json` and `.secretlintrc.json`.
`.tsconfig/base.json` is copied verbatim, so its sync note lives here too.
The comment-free workflow files `.github/workflows/ci.yml` and
`.github/workflows/secret-scan.yml` also follow that sync contract; retain
ARCADE's action and scanner versions/style when updating them.

Keep dependency version specs and `packageManager` aligned. Formatting uses
the same options and import-group ordering without workspace/alias groups.
`docs/plan.md` is intentionally excluded from formatting to preserve the
handoff unchanged. Secret scanning rejects any staged `.env*` except
`.example` templates; never print secret values.
