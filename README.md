# ft

ft gives a team's coding agents one shared way to hand work to other models.

Every person on a team uses their own agent harness, and each harness sets up subagents its own way. So "have a second model review this" means something different for each person, and nobody can improve it for everyone. ft moves that setup into the repository. The repository's `.ft.json` names the models for each kind of work, a pinned version fixes exactly which ft runs, and every agent, in any harness, delegates through the same `ft` command. Change the config once, and every teammate's agent picks it up.

A run works like this. The agent writes the task in a file (a brief), ft runs it on the model the config picks, and the answer comes back for the agent to check and explain to you. Several briefs can run at once. Each run is a separate, pinned [Pi](https://github.com/badlogic/pi-mono) session that works in your working tree, and ft downloads and verifies everything it runs.

## Install

ft runs on Linux and macOS, on x64 or arm64, and downloads its releases with `curl`.

```sh
curl -fsSL https://github.com/superbuilders/ft/releases/latest/download/install.sh | sh
```

This puts `ft` in `~/.local/bin` (set `FT_INSTALL_DIR` to choose another folder) and creates your personal config in `~/.config/ft`. It changes nothing else.

Or install it from npm, if you have [Bun](https://bun.sh):

```sh
bun add -g @superbuilders/ft       # or: npm install -g @superbuilders/ft
ft init --user                     # create your personal config
```

Either way, `ft` is a launcher: in a repository that pins an ft version, it downloads that exact version once and runs it, so everyone on a project runs the same ft.

## Choose a model

You bring and pay for your own API access. Get a key from your provider. For Anthropic, use the [Anthropic Console](https://console.anthropic.com/) and follow its [API key docs](https://platform.claude.com/docs/en/api/overview).

ft starts with an empty config. Add a provider and a role named `code` to `~/.config/ft/.ft.json`:

```json
{
    "$schema": "./.ft/schema.json",
    "providers": {
        "anthropic": { "key": { "env": "ANTHROPIC_API_KEY" } }
    },
    "roles": {
        "code": { "model": "anthropic/claude-opus-5-5", "thinking": "high" }
    }
}
```

- A **provider** says where a model lives and where its key comes from. The key comes from an environment variable (`{ "env": "NAME" }`) or a command that prints it. For example, `{ "command": ["op", "read", "op://vault/item/key"] }` uses [1Password's CLI](https://developer.1password.com/docs/cli/). The item path is a placeholder. ft never writes the key to disk, and only `ft key <provider>` prints it.
- A **role** names a model for a kind of work. `code` is the default. Add other roles and select one with `--role`.

Set `ANTHROPIC_API_KEY` in the environment ft runs in, then check the setup:

```sh
ft doctor
```

It asks each provider whether it accepts the key, then ends with `Ready` or with what to fix.

For valid `provider/model` names, see Pi's [provider docs](https://github.com/badlogic/pi-mono/blob/v1.1.0/packages/coding-agent/docs/providers.md) and [model docs](https://github.com/badlogic/pi-mono/blob/v1.1.0/packages/coding-agent/docs/models.md) for the pinned version, `@earendil-works/pi-ai` 1.1.0. Its [catalog queries](https://github.com/badlogic/pi-mono/blob/v1.1.0/packages/ai/README.md#static-catalog-reads) list the provider and model IDs bundled with that version. ft uses that bundled catalog, not the latest online catalog.

Pi's built-in providers need only a `key`. For a custom OpenAI-compatible endpoint, use a config like this:

```json
{
    "providers": {
        "gateway": {
            "baseUrl": { "env": "GATEWAY_BASE_URL" },
            "api": "openai-completions",
            "key": { "env": "GATEWAY_API_KEY" },
            "models": [{ "id": "your-model-id" }]
        }
    },
    "roles": {
        "code": { "model": "gateway/your-model-id" }
    }
}
```

Set `GATEWAY_BASE_URL` to the endpoint root, including its version path if needed (for example, `https://gateway.example.com/v1`). Set `GATEWAY_API_KEY` to its key. Replace `your-model-id` with an ID your endpoint serves. `ft schema` prints every config field.

This repository's [`.ft.json`](.ft.json) is the maintainers' own config. It uses their private model gateway and will not work without access to it.

For web research, you can add a `research` role using Perplexity's Sonar. Pi 1.1.0 has no built-in Perplexity provider. This config calls Perplexity directly as a custom endpoint with ft's `sonar` adapter:

```json
{
    "providers": {
        "anthropic": { "key": { "env": "ANTHROPIC_API_KEY" } },
        "perplexity": {
            "baseUrl": "https://api.perplexity.ai",
            "api": "openai-completions",
            "key": { "env": "PERPLEXITY_API_KEY" },
            "models": [
                {
                    "id": "sonar",
                    "adapter": "sonar",
                    "reasoning": false,
                    "contextWindow": 127000,
                    "maxTokens": 8192,
                    "compat": {
                        "supportsStore": false,
                        "supportsUsageInStreaming": false,
                        "maxTokensField": "max_tokens"
                    }
                }
            ]
        }
    },
    "roles": {
        "code": { "model": "anthropic/claude-opus-5-5", "thinking": "high" },
        "research": { "model": "perplexity/sonar" }
    }
}
```

Get a [Perplexity API key](https://docs.perplexity.ai/guides/api-key-management) and set `PERPLEXITY_API_KEY`. Run a research brief with `ft run research.md --role research`. Sonar searches the web and runs without local tools.

## Run a brief

A brief is a Markdown file that says what to do and what to report back. For example, `review.md`:

```markdown
Review the README against the code.
Report wrong or missing setup steps, with file paths and line numbers.
```

```sh
ft run review.md                 # run one brief and wait for its report
ft start a.md b.md c.md          # start several and return at once
ft watch <id> <id> <id>          # print each report as its run finishes
ft show <id>                     # every step of one run, and its answer
ft list                          # recent runs
ft roles                         # the roles configured here
ft steer <id> "also check X"     # tell a running run something new
ft stop <id>                     # cancel a run
```

The report names the run's id and where its answer is saved; `ft start` prints the ids and the `ft watch` command to use.

By default a run uses the `read` profile, which tells the model not to change files. That is an instruction, not a sandbox: the model can still run shell commands. Pass `--profile write` for changes your agent will review. ft never commits. Each run keeps its brief, its steps and its answer in a folder of its own, which the report names: `.ft/runs/<id>/` in a repository with its own `.ft.json`, and `~/.local/state/ft/runs/` otherwise, so ft adds nothing to a repository that never set it up.

Each new run deletes finished runs older than 14 days. To keep them longer, set a number of days in your config, or `0` to keep every run. To keep runs somewhere else, set `dir`: a relative path is read from the repository root, and `~` means your home. In your personal config, an absolute path gets one folder per repository.

```json
"runs": { "keepDays": 30, "dir": "~/ft-runs" }
```

## Using ft with an agent

Any harness that can run shell commands can call ft. The optional skill is a short instruction file that tells agents when and how to delegate. Nothing installs it unasked.

```sh
ft skill --user     # for you, in every repository
ft skill            # for everyone working in this repository (commit it)
```

`ft skill` writes `.agents/skills/ft/SKILL.md` in the repository and links `.claude/skills/ft` to that skill directory. `ft skill --user` writes `~/.agents/skills/ft/SKILL.md`. It adds the Claude Code link under `~/.claude/skills/ft` only if `~/.claude` exists.

Pi discovers the `.agents/skills` file automatically. Claude Code discovers it through the `.claude/skills` link. For other harnesses, tell the agent to run `ft guide` before delegating.

Running `ft skill` again after an update refreshes the installed instructions. To let agents run ft without asking each time, allow ft commands in their permission settings.

## Set a repository up for your team

```sh
ft init                                    # start with an empty config
ft init --from ~/.config/ft/.ft.json       # or copy your personal one
```

This writes the files a teammate needs: `.ft.json`, the pinned version in `.ft/lock.json` with the schema beside it, and a launcher at `.ft/ft`. In a JavaScript repository it also adds an `ft` package script, so `bun ft` or `npm run ft --` works without installing anything. Commit these files. Anyone who clones the repository needs curl, plus the provider keys and any endpoint variables the config names.

Where a repository has its own `.ft.json`, ft uses only that file; it does not merge in your personal config. So a new empty repository config needs its own providers and roles before runs work there.

## Two scopes, same commands

| What                  | This repository | You, everywhere                                      |
| --------------------- | --------------- | ---------------------------------------------------- |
| Set up                | `ft init`       | `ft init --user`                                     |
| Change the ft version | `ft pin 0.2.0`  | `ft pin --user 0.2.0`                                |
| Add the agent skill   | `ft skill`      | `ft skill --user`                                    |
| Check the setup       | `ft doctor`     | `ft doctor --user`                                   |
| Where the files live  | the repository  | `~/.config/ft`, and `~/.agents/skills` for the skill |

Plain commands use the config of the folder you are in: the repository's when it has one, otherwise your personal one. A `--user` command always acts on your personal setup, with your personal pinned version, even inside a repository that pins another. `ft doctor` says which config it used.

## Upgrade

```sh
ft upgrade    # or ft update
```

This moves ft on your machine to the newest release: the `ft` command and your personal setup. It never changes a repository's pinned version. To move a repository to the newest release, run `ft pin` there without a version, then commit the files it changes.

If you installed ft from npm, `ft upgrade` moves only your personal setup; update the `ft` command itself with npm or bun.

## Uninstall

```sh
ft uninstall            # removes ft, its downloads and your personal skill; keeps your config
ft uninstall --purge    # also removes your config in ~/.config/ft
```

Repositories set up with `ft init` keep their files. Remove those like any other file in the repository. If you installed ft from npm, remove the `ft` command with npm or bun too.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, checks and pull requests. Coding agents should also read [AGENTS.md](AGENTS.md).

## License

[MIT](LICENSE).
