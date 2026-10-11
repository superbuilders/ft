/** What a lane is for when .ft.json does not say. */
export const LANE_FALLBACK_DESCRIPTION = 'No description in .ft.json.'

/** The guide's fixed body, after the version and the project's lanes. */
export const GUIDE_BODY = `## Run one brief

    ft run --brief tmp/review.md

A brief is the whole task as the other model sees it, written to a file anywhere (ft keeps a copy). \`ft run\` waits, then prints a report: the verdict, the tools used and files written, the answer, and what to do next if it failed. The report's last line repeats the verdict. Exit code 0 means success; the answer is also saved in the run's folder.

Options: \`--name review\` (the start of the run id), \`--lane <lane>\` or \`--model provider/model\`, \`--profile read|write\`, \`--thinking <level>\`, \`--deadline <seconds>\`, \`--cwd <dir>\`, \`--out <path>\` (also write the answer there; removed if the run fails), \`--json\`.

## Run several at once, or anything long

    ft start --brief tmp/review.md --name review        # prints: Started review-k3x2 ...
    ft start --brief tmp/research.md --name research --lane research
    ft wait review-k3x2 research-9f1c --timeout 540

\`ft start\` takes the same options, starts the run detached from your shell and returns at once with its id. \`ft wait <ids>\` prints each run's report as it finishes and exits with the worst run's code. If its timeout ends first, it lists what is still running and exits 75: call it again with the ids it names. Pass every id you started: a run that finished before you called \`ft wait\` is reported only when named (with no ids, \`ft wait\` waits for the runs that are running at that moment). Runs keep going when the shell that started them is killed or backgrounded, so start every run before you wait on any.

## Write the brief

Say what to do and where, what done means, what to leave alone, and the constraints that matter that the repository's instructions do not already state. One task per brief. Its first line becomes the run's title in \`ft runs\`, so make that line name the task. Do not paste the repository's AGENTS.md or CLAUDE.md or its check commands: ft loads those for the delegate.

ft also tells the delegate that it is working for another agent, that nobody can answer questions while it works, and that its final message is its whole report. With the read profile it is told not to change files; with the write profile, to stay in scope, run the repository's checks, and never stage or commit. A brief that says otherwise wins.

## Profiles

- read (default): read, grep, find, ls and bash. For reviews, research and investigation. bash can still change files; the delegate is told not to.
- write: adds edit and write. Write runs share your working tree, so parallel write runs need disjoint files. The report lists files that edit and write changed successfully; changes made through bash are not listed, so check \`git status\`.

A lane whose model cannot use tools (such as a web-research model) runs without tools whatever the profile.

## Reading results

- Exit codes: 0 success; 1 model or runtime error, or a lost run; 2 configuration error; 3 incomplete or unreadable output; 75 still running (\`ft wait\` timed out); 124 deadline reached; 130 cancelled.
- The answer is a claim, not a fact. Check it against the code. After a write run, read \`git diff\` before you accept it; ft never commits.
- A failed run keeps the model's last message as a partial answer, and the report says what to try next.
- \`ft show <id>\` tells the whole story of a run: every step, its timing, the answer. \`ft runs\` lists runs, live. \`ft stop <id>\` cancels one. Ids accept any unambiguous prefix.
- \`--json\` on run, start, wait, runs and show prints one JSON object per run, one per line: the stored status plus \`state\` (the outcome, or \`lost\` when its process died without one).

## In your harness

- Claude Code: allow \`Bash(ft:*)\`. Make \`ft ...\` the whole command (no \`cd dir &&\`, no \`VAR=value ft\`, no redirects), or the allow rule stops matching. A foreground run longer than the tool's time limit moves to the background and still completes; for parallel runs use \`ft start\` and \`ft wait\`.
- Codex: ft needs the network and writes under ~/.cache/ft, which the workspace-write sandbox blocks. Request escalated permissions with the prefix rule ["ft"] so one approval covers later calls. Keep polling \`ft wait\` until it exits.
- Pi: the bash tool blocks until the command exits and keeps only the tail of its output. Use \`ft start\` and \`ft wait\`; every report ends with its verdict.

## A run's folder: .ft/runs/<id>/

brief.md (what was asked), request.json (how), status.json (rewritten while the run works), events.jsonl (Pi's raw event stream), stderr.log, and answer.md on success or partial.md after a failure. The folder ignores itself in git.
`
