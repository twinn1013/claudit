/**
 * Central place for policy constants that govern detector behaviour.
 * Exported so downstream tooling (tests, tutorial docs) can reference them
 * instead of duplicating the magic numbers.
 */

import type { Confidence, Severity } from "./types.js";

/** Per-detector wall-clock budget enforced by the Scanner. */
export const DETECTOR_TIMEOUT_MS = 100;

/** PostToolUse hook latency target (trigger only — no scanning). */
export const POST_TOOL_USE_BUDGET_MS = 200;

/** SessionStart hook latency target when a full scan runs. */
export const SESSION_START_BUDGET_MS = 500;

/** Cap per-snapshot-file size; larger payloads are a hard error. */
export const SNAPSHOT_FILE_MAX_BYTES = 1 * 1024 * 1024;

/** Retain at most this many snapshot files on disk. */
export const SNAPSHOT_RETAIN_COUNT = 2;

/** Truncate each inspected hook script to this many bytes for static analysis. */
export const HOOK_SCRIPT_MAX_BYTES = 4 * 1024;

/**
 * False-positive policy (per deep-interview spec).
 *
 * "Same matcher with multiple hooks" is NOT a collision. Only *confirmed
 * mutual mutation* of `updatedInput` across two hooks on the same
 * event+matcher is reported. One mutating + one opaque hook is `possible`,
 * not `definite`. Benign system binary duplicates (ls/cat/bash…) are
 * allowlisted out of the path-binary detector.
 */
export const FALSE_POSITIVE_POLICY = {
  sameMatcherMultipleHooks: "not-a-collision",
  requiresMutualMutation: true,
  benignBinaryAllowlist: "see BENIGN_SYSTEM_BINARIES in detectors/path-binary",
} as const;

/**
 * False-negative policy (per deep-interview spec).
 *
 * claudit is a static analyzer. It does not execute hook scripts, intercept
 * live hook chains, or introspect CC's internal plugin resolution. These
 * blind spots are mitigated by the `confidence` field on every Collision:
 * consumers should treat `possible` and `unknown` as requiring manual
 * verification.
 */
export const FALSE_NEGATIVE_POLICY = {
  staticAnalyzerOnly: true,
  cannotObserve: [
    "hook execution ordering across plugins",
    "dynamic variable expansion in hook scripts",
    "runtime de-duplication or priority logic inside CC",
    "plugins that mutate their own config after install",
  ],
  mitigation: "Collision.confidence ∈ { 'definite', 'possible', 'unknown' }",
} as const;

/**
 * Map of every Collision category to its default severity. Detectors may
 * override per-collision, but these are the baseline that documentation and
 * tests reference.
 */
export const DEFAULT_SEVERITY: Record<
  | "hook-matcher"
  | "slash-command"
  | "skill-name"
  | "subagent-type"
  | "mcp-identifier"
  | "path-binary"
  | "internal-error",
  Severity
> = {
  "hook-matcher": "critical",
  "slash-command": "warning",
  "skill-name": "warning",
  "subagent-type": "warning",
  "mcp-identifier": "critical",
  "path-binary": "warning",
  "internal-error": "info",
};

/** Ordering used by the Scanner to sort Collisions in a Report. */
export const SEVERITY_ORDER: readonly Severity[] = [
  "critical",
  "warning",
  "info",
];

export const CONFIDENCE_ORDER: readonly Confidence[] = [
  "definite",
  "possible",
  "unknown",
];

// Re-export redaction constants so consumers have a single import source
// for all policy-level configuration.
export { DEFAULT_REDACTOR_PATTERNS, redactCommand } from "./redactor.js";
export type { RedactorPattern, RedactorPatterns } from "./redactor.js";
