---
name: ft
description: Hand a bounded task to another model through ft (a second opinion, a parallel review, web research, or a scoped change you will review). Use when the user asks for a delegate, a second model, or parallel reviews, or when a self-contained task would cost this session more context than its answer is worth.
---

# ft

`ft` runs one brief on one model in an isolated Pi agent and records the run under `.ft/runs/<id>/`.

Start every session that uses ft with:

```bash
ft guide
```

It prints the manual for the exact version this repository pins: the lanes configured here, how to write a brief, the run and watch commands, exit codes, and notes for your harness. Follow it over anything you remember about ft.

If `ft` is not on PATH, run it the way this repository does: through its package script (`bun ft guide`, `npm run ft guide`) or the launcher (`sh .ft/ft guide`). Write every ft command that way, including the ones in the manual.

## The loop

1. Write the brief to a file (for example `tmp/ft/review.md`): the task, where to look, what done means, what to leave alone. One task per brief.
2. Start every brief at once: `ft start tmp/ft/*.md` (or `ft run tmp/ft/review.md` for one short run you can wait on).
3. Wait without blocking if your harness can: run the `ft watch` command that `ft start` prints as a background command that notifies you when it exits (Claude Code: `run_in_background`), and keep working meanwhile. Otherwise run it with `--timeout` and call it again while it exits 75. `ft guide` has the note for your harness.
4. Read the reports and the closing tally. Each report names the answer's file and length; read the answers you need.
5. Treat the answer as a claim. Check it against the code. After a write run, read `git diff` before keeping anything; ft never commits.
6. Tell the user what the delegate found and what you checked, with the run id so they can open it with `ft show <id>`.

## When not to

- The task needs a conversation with the user, or decisions only the user can make.
- The task is smaller than writing its brief.
- Parallel write runs would touch the same files.
