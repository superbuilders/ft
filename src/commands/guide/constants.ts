/** What a role is for when .ft.json does not say. */
export const ROLE_FALLBACK_DESCRIPTION = 'No description in .ft.json.'

/** The guide's fixed body, after the version and the project's roles. */
/** The manual after the roles; guide.ts fills `{read tools}` and `{write tools}` from RUN_PROFILES. */
export const GUIDE_BODY = `## Write the brief

A brief is the whole task as the other model sees it, written to a Markdown file anywhere (ft keeps a copy). Describe the task, where to work, what counts as done, and what to leave alone. Add only the constraints the repository's instructions do not already cover. Keep one task per brief. Its first line with text becomes the run's title in \`ft list\`, so make that line name the task. To keep answers short, ask for that in the brief.

Do not copy the repository's instruction files or check commands into the brief. In each directory from the repository root down to the run's directory, ft loads the first of these that exists: AGENTS.override.md, AGENTS.md, CLAUDE.md.

ft also tells the delegate that it works for another agent, that nobody can answer questions while it works, and that its final message is its whole report. The profile adds standing instructions (see Profiles). A brief that says otherwise wins.

## Run one brief

    ft run tmp/review.md

\`ft run\` waits, then prints a report: the verdict, the tools used and files written, what to do next if it failed, and where the answer is saved with its length in lines. Read the answer file when you need it; \`ft show <id>\` prints it too. Exit code 0 means the model returned a final answer, not that the answer is right.

Options: \`--name review\` (the run id's prefix), \`--role <role>\` or \`--model provider/model\`, \`--profile read|write\`, \`--thinking <level>\`, \`--cwd <dir>\` (the folder the run works in, such as a worktree; the run is still recorded and watched from here), \`--deadline <seconds>\`, \`--out <path>\` (also save the answer there; any file already there is deleted once the run is accepted, and stays deleted if the run fails), \`--json\`.

## Run several at once, or anything long

    ft start tmp/review.md tmp/security.md    # prints a Started line per run, then: Watch with: ft watch ...
    ft start tmp/research.md --role research
    ft watch review-a3c2 security-7d0e research-9f1c --timeout 540

\`ft start\` takes one or more briefs and the same options as \`ft run\`, applied to every run. \`--name\` and \`--out\` work only with a single brief. ft checks every brief before starting any run, starts the runs detached from your shell, and waits up to 10 seconds for each to confirm it started. It prints a Started line for each running run, a report for any run that already ended, and then the \`ft watch\` command for the runs still going. Runs keep going when the shell that started them is killed or backgrounded, so start every run before you wait on any.

Pass every id you started to \`ft watch\`. It reports a named run even if that run finished before you called it; with no ids, it waits only for the runs running at that moment. It prints each run's report as the run finishes, then one line counting the outcomes and naming every run that did not succeed, and exits with the highest exit code among them.

If \`--timeout\` ends first, \`ft watch\` lists the runs still going and exits 75, even when some runs already failed. Call it again with the ids it names, and keep the reports from earlier calls: a later call reports only the runs it names.

Pick a way to wait that fits your shell:

- If you can run a command in the background and be told when it exits, run the printed \`ft watch\` command that way and keep working. Its output holds every report and the tally, so no \`--timeout\` is needed.
- To hear about each run as soon as it finishes, run one background \`ft watch <id>\` per run, or read a single \`ft watch\`'s output as it arrives: it prints each report whole when its run finishes.
- If every command you run blocks until it exits, or has a time limit, run \`ft watch <ids> --timeout <seconds>\` and call it again while it exits 75.

Every report ends with a line restating its verdict, so the end of the output still says how each run ended. If output was cut and a report is missing, \`ft show <id>\` prints it again.

## Profiles

A profile is the delegate's tool set plus standing instructions. Neither profile is a sandbox: both include bash.

- read (default): {read tools}. For reviews, research and investigation. The delegate is told not to change files, but bash can still change them.
- write: adds {write tools}. The delegate is told to stay in scope, run the repository's checks, and never stage, commit or push. Write runs share your working tree, so parallel write runs need disjoint files. The report lists files that edit and write changed; changes made through bash are not listed, so check \`git status\`.

A role whose model is configured as tool-free (such as a web-research model) runs without tools whatever the profile.

## Reading results

- Exit codes of \`ft run\` and of \`ft watch\`: 0 success; 1 model or runtime error, or a lost run; 2 configuration error; 3 incomplete or unreadable output; 75 still running (\`ft watch\` timed out); 124 deadline reached; 130 cancelled. \`ft start\` exits 0 once its runs have started, which says nothing yet about their outcome (a run that already ended sets its own code).
- The answer is a claim, not a fact. Check it against the code, the tests or its cited sources. After a write run, read \`git diff\` before you accept it; ft never commits. When you report back, keep what the other model said apart from what you verified, and say what remains unchecked.
- A failed or stopped run keeps the model's last message as a partial answer when it wrote one. It may be only a progress note, so do not present it as findings. The report says what to try next. A failed write run may already have changed files: check \`git diff\` and \`git status\` before you retry.
- \`ft show <id>\` prints every step of a run, its timing, and the answer itself (cut at 20,000 characters; the file holds all of it). \`ft list\` shows the running runs and the 15 newest, \`ft list --all\` every run. \`ft stop <id>\` cancels one. Ids accept any unambiguous prefix.
- \`ft steer <id> "<message>"\` sends a running run a message instead of stopping and restarting it: narrow the task, add a check, or say when to stop. The model reads it after its current tool calls finish (a long command runs to the end first), and the delegate is told a message wins over the brief. \`ft steer\` returns once the run has queued it; \`ft show <id>\` lists it as a step when the model reads it, and the report counts steers that never arrived (the run finished first).
- \`--json\` on run, start, watch, list and show prints one JSON object per run, one per line: the stored status plus \`state\` (the outcome, or \`lost\` when its process died without one). When ft refuses to start a run, it prints \`{"outcome":"configuration_error","error":...}\` instead.

## Running ft from a sandboxed or permission-checked shell

ft needs the network, and writes under ~/.cache/ft and this repository's .ft/. If your shell blocks either, ask once for ft to run outside those limits, for every ft command rather than one call. Make \`ft ...\` the whole command (no \`cd\`, pipes or \`&&\` around it), so a permission granted for ft covers every call.

## A run's folder: .ft/runs/<id>/

Each run keeps brief.md (the task), request.json (the options) and status.json (updated while it runs). events.jsonl holds Pi's raw events and stderr.log its stderr; a run that failed early may have neither. A successful run saves answer.md, and a failed one saves partial.md if the model wrote anything. The runs folder ignores itself in git.
`
