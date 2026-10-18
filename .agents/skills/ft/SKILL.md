---
name: ft
description: Hand a bounded task to a subagent that ft runs on another model (a second opinion, a parallel review, web research, or a scoped change you will review). Use when the user asks for a delegate, a second model, or parallel reviews, or when a self-contained task would cost this session more context than its answer is worth.
---

# ft

`ft` runs one brief on one model in a separate Pi agent session, in your working tree, and records the run in a folder that its report names.

Run `ft guide` once per session, before your first ft command. Skip it if you already ran it in this session. It prints the manual for the ft version in use here (the roles, how to write a brief, the run and watch commands, and exit codes), and it wins over anything you remember about ft.

To check which roles are configured here without rereading the manual, run `ft roles`.

Try plain `ft guide` first. Only if the shell says `ft` is not found, run it the way this repository does: through its package script (`bun ft guide`, `npm run ft -- guide`) or the launcher (`sh .ft/ft guide`). Then write every ft command that way, including the ones in the manual.

## Talking to the user

Call them subagents, then refer to the work: "the review", "the investigation", "the proposed change". ft is the tool, not the author. Name the model only when it matters, such as when it changes how far to trust an answer; role names, profiles and exit codes are command details.

Before starting, say in a line what the subagents will do and why, as the work rather than the routing: "Five subagents are reviewing the branch in parallel, one angle each", not "I'm giving the check to another model as five separate reviews". While it works, update the user only when there is something useful to say, such as what you are doing meanwhile or a delay that changes the plan. Do not invent progress. A watch timeout ends your wait, not the model's work.

## The loop

1. Write the brief to a file (for example `tmp/ft/review.md`): the task, where to look, what done means, what to leave alone. One task per brief.
2. Start every brief for this task at once, by name: `ft start tmp/ft/review.md tmp/ft/security.md` (or `ft run tmp/ft/review.md` for one short run you can wait on).
3. Wait without blocking if you can: run the `ft watch` command that `ft start` prints in the background, in a way that tells you when it exits, and keep working meanwhile. If you cannot, run it with `--timeout <seconds>`; while it exits 75, keep the reports it printed and call it again with the ids it names.
4. Read the reports. Each names the answer's file and length (a failed run may have none); read the answers you need.
5. Treat the answer as a claim. Check it against the code. After a write run, read `git diff` before keeping anything; ft never commits. A partial answer from a failed run may be only a progress note.
6. Tell the user what came back, what you verified, and what remains unchecked. If the run failed, say whether anything usable came back and what you will do next. Leave out run ids and `ft show` commands unless the user asks for them.

## When not to

- The task needs a conversation with the user, or decisions only the user can make.
- The task is smaller than writing its brief.
- Parallel write runs would touch the same files.
