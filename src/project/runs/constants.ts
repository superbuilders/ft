/** Runs live in the project, beside the lock, so humans and agents reach them by a relative path. */
export const RUNS_DIR = '.ft/runs'

/** Written into the runs folder so it ignores itself without touching the project's .gitignore. */
export const RUNS_GITIGNORE = '*\n'

/** Files inside one run's folder. */
export const RUN_FILES = {
    request: 'request.json',
    brief: 'brief.md',
    status: 'status.json',
    events: 'events.jsonl',
    stderr: 'stderr.log',
    answer: 'answer.md',
    partial: 'partial.md',
} as const

/** Random characters after the name in a run id: enough that parallel starts do not collide. */
export const ID_SUFFIX_LENGTH = 4

/** Longest name part of a run id. */
export const ID_NAME_MAX = 24

/** Name used when neither --name nor a brief file name gives one. */
export const DEFAULT_RUN_NAME = 'run'

/** Longest title kept from a brief's first line. */
export const TITLE_MAX = 72

/** Exit code for each state; `running` is what `ft watch` returns when its timeout ends first (EX_TEMPFAIL). */
export const EXIT_CODES = {
    success: 0,
    model_error: 1,
    runtime_error: 1,
    lost: 1,
    configuration_error: 2,
    incomplete: 3,
    protocol_error: 3,
    timeout: 124,
    cancelled: 130,
    running: 75,
} as const

/**
 * Characters of answer printed inline. Harnesses keep about 30k characters (Claude Code) to 10k
 * tokens (Codex) of a command's output; past this the answer stays in its file.
 */
export const INLINE_ANSWER_MAX = 20_000

/** What to do next, by state; the context-overflow hint replaces the model_error one when it matches. */
export const NEXT_STEPS = {
    configuration_error:
        'Fix the problem the error names, then start the run again. ft doctor checks the config, keys and runtime.',
    model_error:
        'The model provider returned an error. If it looks transient, start the run again; otherwise <ft> show <id> has the details.',
    context_overflow:
        "The brief and the files the model read did not fit the model's context window. Narrow the brief or point it at fewer files, or use a role whose model has a larger window.",
    incomplete: 'Pi stopped without a final answer. <ft> show <id> shows how far it got.',
    protocol_error:
        "Pi's output could not be read. See <ft> show <id> and the run's stderr.log for details.",
    runtime_error:
        "ft or Pi failed while running the session. See <ft> show <id> and the run's stderr.log for details.",
    timeout:
        'The run reached its deadline. Raise --deadline or narrow the brief, then start it again.',
    cancelled: 'The run was stopped by a signal. Start it again if it is still needed.',
    lost: "The run's process is gone and no outcome was saved. <ft> show <id> has the steps it took; start it again if it is still needed.",
} as const

/** A running run rewrites its status at most this often, so readers see it move without a write per token. */
export const STATUS_INTERVAL_MS = 1000
