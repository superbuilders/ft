/** What a lane is for when .ft.json does not say. */
export const LANE_FALLBACK_DESCRIPTION = 'No description in .ft.json.'

/** The guide's fixed body, after the version and the project's lanes. */
export const GUIDE_BODY = `## Run one brief

    ft run tmp/review.md

A brief is the whole task as the other model sees it, written to a file anywhere (ft keeps a copy). \`ft run\` waits, then prints a report: the verdict, the tools used and files written, what to do next if it failed, and where the answer is saved with its length in lines. Read the answer file when you need it; \`ft show <id>\` prints it too. The report's last line repeats the verdict. Exit code 0 means success. To keep answers short, ask for that in the brief.

Options: \`--name review\` (the start of the run id), \`--lane <lane>\` or \`--model provider/model\`, \`--profile read|write\`, \`--thinking <level>\`, \`--deadline <seconds>\`, \`--cwd <dir>\`, \`--out <path>\` (also write the answer there; any file already there is deleted first and stays deleted if the run fails), \`--json\`.

## Run several at once, or anything long

    ft start tmp/review.md tmp/security.md    # prints a Started line per run, then: Watch with: ft watch ...
    ft start tmp/research.md --lane research
    ft watch review-a3c2 security-7d0e research-9f1c --timeout 540

\`ft start\` takes one or more briefs and the same options, which apply to every run (\`--name\` and \`--out\` take a single brief). It checks every brief before starting any, starts the runs detached from your shell, and returns as soon as each has started (a few seconds at most): one line per run, then the \`ft watch\` command for them. Use the ids it prints. \`ft watch <ids>\` prints each run's report as it finishes, then one line counting the outcomes and naming every run that did not succeed, and exits with the worst run's code. If its timeout ends first, it lists what is still running and exits 75, even when some runs already failed: call it again with the ids it names, and keep the reports from earlier calls, since a later call reports only the runs it names. Pass every id you started: a run that finished before you called \`ft watch\` is reported only when named (with no ids, \`ft watch\` waits for the runs that are running at that moment). Runs keep going when the shell that started them is killed or backgrounded, so start every run before you wait on any.

Wait without blocking if you can. If you can run a command in the background and be told when it exits, run the \`ft watch\` command that way, keep working, and read its output when you are told: it holds every report and the tally, so no \`--timeout\` is needed. To hear about each run as soon as it finishes, run one background \`ft watch <id>\` per run, or watch \`ft watch\`'s output as it arrives: it prints each report whole when its run finishes. If every command you run blocks until it exits, or has a time limit, run \`ft watch <ids> --timeout <seconds>\` and call it again while it exits 75. Every report ends with a line restating its verdict, so output cut to its last lines still says how each run ended.

## Write the brief

Say what to do and where, what done means, what to leave alone, and the constraints that matter that the repository's instructions do not already state. One task per brief. Its first line becomes the run's title in \`ft list\`, so make that line name the task. Do not paste the repository's AGENTS.md or CLAUDE.md or its check commands: ft loads one instruction file per directory (AGENTS.md, or CLAUDE.md where there is no AGENTS.md) from the repository root down to the run's directory.

ft also tells the delegate that it is working for another agent, that nobody can answer questions while it works, and that its final message is its whole report. With the read profile it is told not to change files; with the write profile, to stay in scope, run the repository's checks, and never stage or commit. A brief that says otherwise wins.

## Profiles

- read (default): read, grep, find, ls and bash. For reviews, research and investigation. bash can still change files; the delegate is told not to.
- write: adds edit and write. Write runs share your working tree, so parallel write runs need disjoint files. The report lists files that edit and write changed successfully; changes made through bash are not listed, so check \`git status\`.

A lane whose model is configured as tool-free (such as a web-research model) runs without tools whatever the profile.

## Reading results

- Exit codes of \`ft run\` and of \`ft watch\`: 0 success; 1 model or runtime error, or a lost run; 2 configuration error; 3 incomplete or unreadable output; 75 still running (\`ft watch\` timed out); 124 deadline reached; 130 cancelled. \`ft start\` exits 0 once its runs have started; that says nothing yet about their outcome.
- The answer is a claim, not a fact. Check it against the code. After a write run, read \`git diff\` before you accept it; ft never commits.
- A failed run keeps the model's last message as a partial answer when it wrote one, and the report says what to try next.
- \`ft show <id>\` tells the whole story of a run: every step, its timing, and the answer itself (cut at 20,000 characters; the file holds all of it). \`ft list\` shows the running runs and the 15 newest, \`ft list --all\` every run. \`ft stop <id>\` cancels one. Ids accept any unambiguous prefix.
- \`--json\` on run, start, watch, list and show prints one JSON object per run, one per line: the stored status plus \`state\` (the outcome, or \`lost\` when its process died without one). When ft refuses to start a run, it prints \`{"outcome":"configuration_error","error":...}\` instead.

## Running ft from a sandboxed or permission-checked shell

ft needs the network, and writes under ~/.cache/ft and this repository's .ft/. If your shell blocks either, ask once for ft to run outside those limits, for every ft command rather than one call. Make \`ft ...\` the whole command (no \`cd\`, pipes or \`&&\` around it), so a permission granted for ft covers every call.

## A run's folder: .ft/runs/<id>/

brief.md (what was asked), request.json (how), status.json (rewritten while the run works), events.jsonl (Pi's raw event stream), stderr.log, and answer.md on success or partial.md after a failure. The folder ignores itself in git.
`
