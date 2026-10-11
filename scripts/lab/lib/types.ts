import type { Target } from '../../../src/types'

/**
 * Validated commander inputs shared by native and remote execution.
 */
export interface Options {
    /** Execution host, never inferred from the network endpoint. */
    host: 'local' | 'air' | 'both'
    /** Select every non-real scenario, never live checks. */
    all?: boolean
    /** Retain this run only; persistent caches are unaffected. */
    keep?: boolean
    /** Build and runtime cache state must start empty. */
    cold?: boolean
    /** Previously acquired archive directory, verified against baked hashes. */
    archives?: string
    /** A release-shaped folder of prebuilt binaries to test instead of compiling, such as CI's release build. */
    artifacts?: string
    /** Explicit real project used only by the paid scenario. */
    project?: string
    /** Exact baked or published release version. */
    version?: string
}

/**
 * Named comparison retaining both sides for unattended consumers.
 */
export interface Assertion {
    /** Stable assertion or asset discriminator. */
    name: string
    /** Deep equality of expected and observed values. */
    passed: boolean
    /** Required behavior, independent of child exit conventions. */
    expected: unknown
    /** Evidence captured from the actual run. */
    observed: unknown
}

/**
 * Single terminal JSON contract; no child pipes are echoed separately.
 */
export interface Result {
    /** Wire discriminator fixed at 1. */
    schemaVersion: 1
    /** Collision-resistant identifier safe as a directory basename. */
    runId: string
    /** Execution host, never inferred from the network endpoint. */
    host: string
    /** Exactly one named test or ad hoc exec. */
    scenario: string
    /** Baked lab identity, null before successful build. */
    buildVersion: string | null
    /** Final native binary SHA-256, after signing. */
    buildDigest: string | null
    /** Verdict distinguishing product, prerequisite and infrastructure failures. */
    outcome: 'passed' | 'failed' | 'prerequisite_error' | 'lab_error'
    /** Named comparisons in execution order. */
    assertions: Assertion[]
    /** Elapsed wall-clock milliseconds by phase. */
    phases: Record<string, number>
    /** Owned scratch paths deliberately retained. */
    keptPaths: string[]
    /** Removal verdict; failure overrides the scenario verdict. */
    cleanup: { outcome: 'removed' | 'kept' | 'failed'; error?: string }
    /** Non-secret diagnostic for prerequisite or infrastructure failures. */
    error?: string
    /** Ad hoc child exit and pipes; runDirectory can already have been removed. */
    execution?: { exitCode: number; stdout: string; stderr: string; runDirectory: string }
    /** Redacted stderr tails for all scenario children when an assertion fails. */
    childStderr?: ChildStderr[]
}

/**
 * Terminal envelope for multiple scenarios or hosts.
 */
export interface Aggregate {
    /** Wire discriminator fixed at 1. */
    schemaVersion: 1
    /** Requested execution host(s). */
    host: Options['host']
    /** Most severe verdict: lab failure, assertion failure, usage, pass. */
    outcome: Result['outcome']
    /** Flat host-major scenario results, local before air. */
    results: Result[]
}

/**
 * Captured child diagnostics, safe to embed in a terminal result.
 */
export interface ChildStderr {
    /** Executable passed to the scenario's child launcher. */
    argv0: string
    /** Normalized child exit code. */
    code: number
    /** Last forty stderr lines with the dummy key redacted. */
    tail: string
}

/**
 * Native release bytes identified by compiler, target and source inputs.
 */
export interface Build {
    /** Exact baked or published release version. */
    version: string
    /** SHA-256 of final signed native executable. */
    digest: string
    /** Supported native OS and architecture pair. */
    target: Target
    /** Absolute lab-owned path, never a personal cache. */
    directory: string
    /** Compiled executable or archive-relative executable name. */
    binary: string
}

/**
 * Drained subprocess pipes and normalized child exit code.
 */
export interface Capture {
    /** Normalized subprocess exit code. */
    code: number
    /** Captured standard output; never printed as a second object. */
    stdout: string
    /** Captured diagnostics, kept separate from standard output. */
    stderr: string
}

/**
 * Owned process-group leader and bounded completion promise.
 */
export interface Child {
    /** Owned process-group leader, never a broad process-name match. */
    pid: number
    /** Bounded completion or schema result receiving evidence. */
    result: Promise<Capture>
}

/**
 * Run-local state and explicit ownership ledger for cleanup.
 */
export interface Context {
    /** Absolute lab-owned path, never a personal cache. */
    directory: string
    /** Build/runtime cache root owned exclusively by this lab. */
    cache: string
    /** Selected immutable native release bundle. */
    build: Build
    /** Explicit real project used only by the paid scenario. */
    project: string
    /** Explicit scratch environment, not ambient credentials. */
    env: NodeJS.ProcessEnv
    /** Bounded completion or schema result receiving evidence. */
    result: Result
    /** Recorded owned group leaders and executable provenance. */
    processes: Map<number, string>
    /** Child diagnostics in launch order, populated after pipe drainage. */
    childStderr: ChildStderr[]
}

/**
 * OpenAI-compatible loopback request, never a real credential transport.
 */
export interface ModelRequest {
    /** Exact model id received by the loopback fixture. */
    model: string
    /** False selects the non-streaming research fixture. */
    stream?: boolean
    /** Provider conversation retained to assert context and tool round trips. */
    messages: { role: string; content?: unknown }[]
}

/**
 * Pinned upstream archive identity used by the offline transport fixture.
 */
export interface Archive {
    /** Stable assertion or asset discriminator. */
    name: 'pi' | 'rg' | 'fd'
    /** Exact upstream release basename. */
    asset: string
    /** Trusted baked archive checksum. */
    sha256: string
    /** Exact baked or published release version. */
    version: string
    /** Immutable runtime path relative to ft cache root. */
    final: string
    /** Public upstream download the runner itself uses; the lab fetches it once per host. */
    url: string
}
