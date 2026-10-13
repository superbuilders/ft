# ft

ft gives a team's coding agents one shared way to hand work to other models.

Every person on a team uses their own agent harness, and each harness sets up subagents its own way. So "have a second model review this" means something different for each person, and nobody can improve it for everyone. ft moves that setup into the repository. The repository's `.ft.json` names the models for each kind of work, a pinned version fixes exactly which ft runs, and every agent, in any harness, delegates through the same `ft` command. Change the config once, and every teammate's agent picks it up.

A run works like this. The agent writes the task in a file (a brief), ft runs it on the model the config picks, and the answer comes back for the agent to check and explain to you. Several briefs can run at once. Each run is a separate, pinned [Pi](https://github.com/badlogic/pi-mono) session that works in your working tree, and ft downloads and verifies everything it runs.

## Install

ft runs on Linux and macOS, on x64 or arm64. You need the [GitHub CLI](https://cli.github.com), signed in (`gh auth login`).

```sh
gh release download -R superbuilders/ft -p install.sh -O - | sh
```

This puts `ft` in `~/.local/bin` (set `FT_INSTALL_DIR` to choose another folder) and creates your personal config in `~/.config/ft`. It changes nothing else.

## Choose a model

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

- A **provider** says where a model lives and where its key comes from. The key comes from an environment variable (`{ "env": "NAME" }`) or from a command that prints it (`{ "command": ["op", "read", "op://vault/item/key"] }`). ft never writes the key to disk, and only `ft key <provider>` prints it.
- A **role** names a model for a kind of work. `code` is the default. A repository can add others and pick one with `--role`: for example a `research` role on a model that searches the web, such as Perplexity's Sonar, so agents can look up prior art before a big design decision.
- Any of Pi's built-in providers works with just a `key`. For your own endpoint, add `baseUrl`, `api` and `models`. This repository's `.ft.json` is a full example, and `ft schema` prints every field.

Set `ANTHROPIC_API_KEY` in the environment ft runs in, then check the setup:

```sh
ft doctor
```

It asks each provider whether it accepts the key, then ends with `Ready` or with what to fix.

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
ft stop <id>                     # cancel a run
```

The report names the run's id and where its answer is saved; `ft start` prints the ids and the `ft watch` command to use.

By default a run uses the `read` profile, which tells the model not to change files. That is an instruction, not a sandbox: the model can still run shell commands. Pass `--profile write` for changes your agent will review. ft never commits. Each run keeps its brief, its steps and its answer in `.ft/runs/<id>/` in the repository you ran it from.

## Let your agents use ft

Agents learn ft from a skill, a short file that tells them when and how to delegate. Nothing installs it unasked.

```sh
ft skill --user     # for you, in every repository
ft skill            # for everyone working in this repository (commit it)
```

Running it again after an update refreshes the skill. To let agents run ft without asking each time, allow ft commands in their permission settings. Agents read the full manual with `ft guide`.

## Set a repository up for your team

```sh
ft init                                    # start with an empty config
ft init --from ~/.config/ft/.ft.json       # or copy your personal one
```

This writes the files a teammate needs: `.ft.json`, the pinned version in `.ft/lock.json` with the schema beside it, and a launcher at `.ft/ft`. In a JavaScript repository it also adds an `ft` package script, so `bun ft` or `npm run ft --` works without installing anything. Commit these files. Anyone who clones the repository then needs only gh, signed in, and the provider keys the config names.

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

## Uninstall

```sh
ft uninstall            # removes ft, its downloads and your personal skill; keeps your config
ft uninstall --purge    # also removes your config in ~/.config/ft
```

Repositories set up with `ft init` keep their files. Remove those like any other file in the repository.

## Developing ft

See [AGENTS.md](AGENTS.md).
