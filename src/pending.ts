import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { redactCommand } from "./redactor.js";

/** Default pending marker directory — `~/.claude/claudit/pending/`. */
export const defaultPendingDir = (): string =>
  join(homedir(), ".claude", "claudit", "pending");

export interface PendingMarker {
  timestamp: string;         // ISO 8601
  trigger: "PostToolUse" | "SessionStart" | "manual";
  command: string;
  matched_pattern: string;
}

export interface WritePendingMarkerOptions {
  dir?: string;
  marker: PendingMarker;
  /** Override for tests. */
  fs?: typeof fs;
  /** Override the random hash suffix. */
  hashSuffix?: string;
}

/**
 * Write a pending marker atomically: payload lands in a .tmp file first, then
 * renamed into place. This prevents SessionStart from reading a half-written
 * file if it happens to scan the directory mid-write.
 *
 * Filenames include both the marker timestamp and a random suffix, so parallel
 * PostToolUse invocations never collide even with identical timestamps.
 */
export async function writePendingMarker(
  options: WritePendingMarkerOptions,
): Promise<string> {
  const fsImpl = options.fs ?? fs;
  const dir = options.dir ?? defaultPendingDir();
  await fsImpl.mkdir(dir, { recursive: true });
  const hash = options.hashSuffix ?? randomBytes(4).toString("hex");
  const safeTs = options.marker.timestamp.replace(/[:.]/g, "-");
  const name = `${safeTs}-${hash}.json`;
  const target = join(dir, name);
  const tmp = `${target}.tmp`;
  const redacted: PendingMarker = {
    ...options.marker,
    command: redactCommand(options.marker.command),
  };
  await fsImpl.writeFile(tmp, JSON.stringify(redacted), "utf8");
  await fsImpl.rename(tmp, target);
  return target;
}

export interface ListPendingOptions {
  dir?: string;
  fs?: typeof fs;
}

export interface LoadedPendingMarker extends PendingMarker {
  /** Absolute path to the marker file. */
  path: string;
}

/**
 * List pending markers on disk, parsed. Files that cannot be parsed are
 * skipped silently (SessionStart will retry on the next run; stale garbage
 * gets pruned manually).
 */
export async function listPendingMarkers(
  options: ListPendingOptions = {},
): Promise<LoadedPendingMarker[]> {
  const fsImpl = options.fs ?? fs;
  const dir = options.dir ?? defaultPendingDir();
  let entries: string[];
  try {
    entries = await fsImpl.readdir(dir);
  } catch {
    return [];
  }
  const out: LoadedPendingMarker[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".json") || entry.endsWith(".tmp")) continue;
    const full = join(dir, entry);
    try {
      const raw = await fsImpl.readFile(full, "utf8");
      const parsed = JSON.parse(raw) as PendingMarker;
      if (
        typeof parsed.timestamp === "string" &&
        typeof parsed.command === "string" &&
        typeof parsed.matched_pattern === "string"
      ) {
        out.push({ ...parsed, path: full });
      }
    } catch {
      // skip unparseable file
    }
  }
  return out;
}

/**
 * Delete a pending marker by its absolute path. Best-effort; returns true
 * on success, false if the file was already gone.
 */
export async function deletePendingMarker(
  path: string,
  fsImpl: typeof fs = fs,
): Promise<boolean> {
  try {
    await fsImpl.unlink(path);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Install command regex set (Stage 11 / plan-defined initial 10 patterns).
// ---------------------------------------------------------------------------

export interface InstallPatternMatch {
  pattern: string;
}

export const INSTALL_PATTERNS: ReadonlyArray<RegExp> = [
  /\bbrew install\s+\S/,
  /\bnpm\s+(?:install|i)\s+-g\s+\S/,
  /\bcargo install\s+\S/,
  /\bpip3?\s+install\s+\S/,
  /\bpipx install\s+\S/,
  /\buv\s+(?:add|tool install)\s+\S/,
  /(?:\bcurl|\bwget)\s+[^|]*\|\s*(?:sh|bash)\b/,
  /\brtk init\b/,
  /\bclaude\s+(?:plugin\s+install|mcp\s+add)\s+\S/,
  /\bgo install\s+\S/,
];

/**
 * Return the first INSTALL_PATTERNS entry that matches the command string,
 * or null if none match. The returned string is the regex source so it
 * round-trips cleanly through JSON.
 */
export function matchInstallPattern(command: string): InstallPatternMatch | null {
  for (const re of INSTALL_PATTERNS) {
    if (re.test(command)) return { pattern: re.source };
  }
  return null;
}
