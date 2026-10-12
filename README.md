# ft

ft lets a coding agent hand a task to another model. You write the task in a file (a brief), ft runs it on the model you chose, and the answer lands in a file the agent reads when it is ready. Several briefs can run at once.

Under the hood each run is a pinned, isolated [Pi](https://github.com/badlogic/pi-mono) session. ft downloads and verifies everything it runs.

## Install

You need the [GitHub CLI](https://cli.github.com), signed in (`gh auth login`).

```sh
gh api repos/superbuilders/ft/contents/install.sh -H 'Accept: application/vnd.github.raw' | sh
```

This puts `ft` in `~/.local/bin` (set `FT_INSTALL_DIR` to choose another folder) and creates your personal config in `~/.config/ft`. It changes nothing else. Run it again at any time to update `ft` itself.

## Choose a model

ft starts with an empty config. Add a provider and a lane named `code` to `~/.config/ft/.ft.json`:

```json
{
    "$schema": "./.ft/schema.json",
    "providers": {
        "anthropic": { "key": { "env": "ANTHROPIC_API_KEY" } }
    },
    "lanes": {
        "code": { "model": "anthropic/claude-opus-5-5", "thinking": "high" }
    }
}
```

- A **provider** says where a model lives and where its key comes from. The key comes from an environment variable (`{ "env": "NAME" }`) or from a command that prints it (`{ "command": ["op", "read", "op://vault/item/key"] }`). ft never writes the key to disk or to its output.
- A **lane** names a model for a kind of work. `code` is the default. Add others, such as `research`, and pick one with `--lane`.
- Any of Pi's built-in providers works with just a `key`. For your own endpoint, add `baseUrl`, `api` and `models`. This repository's `.ft.json` is a full example, and `ft schema` prints every field.

Then check it:

```sh
ft doctor
```

## Run a brief

A brief is a Markdown file that says what to do and what to report back.

```sh
ft run review.md                 # run one brief and wait for its report
ft start a.md b.md c.md          # start several and return at once
ft watch                         # print each report as its run finishes
ft show <id>                     # every step of one run, and its answer
ft list                          # recent runs
ft stop <id>                     # cancel a run
```

Runs read the code but change nothing, unless you pass `--profile write`. ft never commits. Each run keeps its brief, its steps and its answer in `.ft/runs/<id>/` in the repository you ran it from.

## Let your agents use ft

Agents learn ft from a skill, a short file that tells them when and how to delegate. Nothing installs it unasked.

```sh
ft skill --user     # for you, in every repository
ft skill            # for everyone working in this repository (commit it)
```

Running it again after an update refreshes the skill. To let Claude Code run ft without asking each time, allow `Bash(ft:*)` in its settings. Agents read the full manual with `ft guide`.

## Set a repository up for your team

```sh
ft init
```

This writes the files a teammate needs: `.ft.json`, the pinned version in `.ft/lock.json`, and a launcher at `.ft/ft`. In a JavaScript repository it also adds an `ft` package script, so `bun ft` or `npm run ft --` works without installing anything. Commit these files. Anyone who clones the repository then needs only gh, signed in.

A repository's own `.ft.json` always wins. Your personal config applies only where a repository has none.

## Two scopes, same commands

| What                  | This repository | You, everywhere                                      |
| --------------------- | --------------- | ---------------------------------------------------- |
| Set up                | `ft init`       | `ft init --user`                                     |
| Change the ft version | `ft pin 0.2.0`  | `ft pin --user 0.2.0`                                |
| Add the agent skill   | `ft skill`      | `ft skill --user`                                    |
| Where the files live  | the repository  | `~/.config/ft`, and `~/.agents/skills` for the skill |

`ft doctor` always says which config it used.

## Uninstall

```sh
rm -rf ~/.local/bin/ft ~/.config/ft ~/.cache/ft ~/.agents/skills/ft ~/.claude/skills/ft
```

## Developing ft

See [AGENTS.md](AGENTS.md).
