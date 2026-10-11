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

It prints the manual for the exact version this repository pins: the lanes configured here, how to write a brief, the run and wait commands, exit codes, and notes for your harness. Follow it over anything you remember about ft.

## The loop

1. Write the brief to a file (for example `tmp/ft/review.md`): the task, where to look, what done means, what to leave alone. One task per brief.
2. One run: `ft run --brief tmp/ft/review.md`. Several, or anything that may run long: `ft start` each brief, then `ft wait` with every id it printed.
3. Read the report. Its last line repeats the verdict; the exit code says the same.
4. Treat the answer as a claim. Check it against the code. After a write run, read `git diff` before keeping anything; ft never commits.
5. Tell the user what the delegate found and what you checked, with the run id so they can open it with `ft show <id>`.

## When not to

- The task needs a conversation with the user, or decisions only the user can make.
- The task is smaller than writing its brief.
- Parallel write runs would touch the same files.
