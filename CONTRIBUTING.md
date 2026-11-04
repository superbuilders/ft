# Contributing

Open bug reports and feature requests in [GitHub issues](https://github.com/superbuilders/ft/issues). Include steps to reproduce a bug and the ft version you used. Do not include API keys or other secrets.

## Prerequisites

- [Bun](https://bun.sh) 1.3.13, the version in `package.json`'s `packageManager` field.
- `curl`, which ft uses to download its releases.

## Set up

Fork [superbuilders/ft](https://github.com/superbuilders/ft) on GitHub. Clone your fork and create a branch for your change:

```sh
git clone https://github.com/YOUR_ACCOUNT/ft.git
cd ft
git switch -c your-change
bun install
```

`bun install` installs dependencies and prepares the Git hooks. Read [AGENTS.md](AGENTS.md) for the source layout and coding rules.

## Validate changes

Run typecheck and the tests for the files you changed:

```sh
bun run typecheck
bun run test src/commands/init/init.test.ts
```

Replace the test path with the relevant test files or directories. Tests live beside their sources as `*.test.ts`.

Typecheck, tests, lint, formatting and unused-code checks need no model credentials. The tests use local doubles rather than paid model calls.

Git hooks run validation. Pre-commit scans for secrets, lints and formats staged files. Pre-push runs typecheck, lint, format validation, type-aware lint and knip. CI runs the full test suite on pull requests and pushes to `main`.

`bun run check` and test runs without a file or directory are reserved for hooks and CI. Use typecheck and focused tests while working. Do not bypass the hooks.

## Optional delegation with ft-dev

The repository's `.ft.json` points at the maintainers' private model gateway. You do not need access to it to contribute, run tests or run checks.

To delegate with `ft-dev`, first build it from the last commit:

```sh
bun run dogfood
```

Edit `.ft.json` locally to use your own provider and API key source. See the [README](README.md#choose-a-model) for config examples. Do not commit that local config change. You pay for any API calls you make.

## Send a pull request

Keep the change focused and add tests for changed behavior. Run typecheck and the relevant tests, then commit on your branch. Push the branch to your fork and open a pull request against `superbuilders/ft`'s `main` branch. Describe the change, link any related issue and list the checks you ran.

## Maintainers only

Run `bun run release <patch|minor|major|x.y.z>` to release a version. This bumps the version, creates a tag and pushes the commit and tag. GitHub Actions builds the release, publishes it on GitHub, then publishes the same version to npm as `@superbuilders/ft`.
