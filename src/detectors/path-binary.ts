import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import type { Stats } from "node:fs";
import type { Detector } from "../detector.js";
import type { Collision, SnapshotData } from "../types.js";

/**
 * Commands whose multi-location presence is almost always benign — the OS
 * ships these at both /bin and /usr/bin (often as symlinks). Flagging them
 * would produce false positives on every macOS and most Linux hosts.
 */
export const BENIGN_SYSTEM_BINARIES: ReadonlySet<string> = new Set([
  "ls",
  "cat",
  "cp",
  "mv",
  "rm",
  "ps",
  "kill",
  "sh",
  "bash",
  "zsh",
  "echo",
  "pwd",
  "date",
  "chmod",
  "chown",
  "link",
  "ln",
  "mkdir",
  "rmdir",
  "sleep",
  "test",
  "true",
  "false",
  "wait",
  "which",
  "env",
]);

export interface PathBinaryDetectorOptions {
  /** Override for tests — supply contents keyed by absolute path. */
  readFile?: (path: string) => Promise<Buffer>;
  /**
   * Override for tests. Default `fs.stat` so symlinks are followed to their
   * resolved target before we check whether the entry is a plain executable.
   */
  stat?: (path: string) => Promise<Stats>;
  /**
   * Override for tests. Default `fs.realpath` to resolve symlink chains.
   * Used to obtain the canonical path whose content we hash, so two symlinks
   * pointing at the same target always produce the same hash.
   */
  realpath?: (path: string) => Promise<string>;
  /** Override allowlist. Defaults to BENIGN_SYSTEM_BINARIES. */
  allowlist?: ReadonlySet<string>;
}

export class PathBinaryDetector implements Detector {
  readonly category = "path-binary" as const;

  private readonly readFile: (path: string) => Promise<Buffer>;
  private readonly stat: (path: string) => Promise<Stats>;
  private readonly realpath: (path: string) => Promise<string>;
  private readonly allowlist: ReadonlySet<string>;

  constructor(options: PathBinaryDetectorOptions = {}) {
    this.readFile = options.readFile ?? ((p) => fs.readFile(p));
    this.stat = options.stat ?? ((p) => fs.stat(p));
    this.realpath = options.realpath ?? ((p) => fs.realpath(p));
    this.allowlist = options.allowlist ?? BENIGN_SYSTEM_BINARIES;
  }

  async analyze(current: SnapshotData): Promise<Collision[]> {
    const collisions: Collision[] = [];
    for (const [name, paths] of Object.entries(current.pathBinaries)) {
      if (paths.length < 2) continue;
      if (this.allowlist.has(name)) continue;

      const hashes = await Promise.all(
        paths.map(async (p) => ({ path: p, hash: await this.safeHash(p) })),
      );

      // Filter out entries that returned null (non-executable, unreadable,
      // symlink loop, or non-file). Only consider valid executable entries.
      const valid = hashes.filter((h): h is { path: string; hash: string } => h.hash !== null);
      if (valid.length < 2) continue;

      const uniqueHashes = new Set(valid.map((h) => h.hash));
      if (uniqueHashes.size === 1) {
        // all executable copies byte-identical (likely hard link / same target) — skip
        continue;
      }

      const validPaths = valid.map((h) => h.path);
      const message = `Binary "${name}" appears at ${validPaths.length} PATH locations with ${uniqueHashes.size} distinct contents — earlier PATH entries shadow later ones.`;

      collisions.push({
        category: "path-binary",
        severity: "warning",
        confidence: "definite",
        entities_involved: validPaths,
        suggested_fix: [
          {
            command: `which -a ${name}`,
            scope: "shell",
            safety_level: "safe",
            rationale: "List every copy on your PATH to decide which to keep.",
          },
        ],
        message,
      });
    }
    return collisions;
  }

  private async safeHash(path: string): Promise<string | null> {
    try {
      // Follow symlinks via `stat` so legitimate shims (e.g. Homebrew stubs)
      // are treated as the file they point at.
      const statResult = await this.stat(path);
      if (!statResult.isFile()) return null;

      // Executable-bit filter — skip non-executable files in PATH dirs.
      // On Windows `mode` is always 0o666/0o777, so we skip the check there.
      if (process.platform !== "win32") {
        const isExec = (statResult.mode & 0o111) !== 0;
        if (!isExec) return null;
      }

      // Resolve symlink chain to canonical path. Hash the target's content so
      // two symlinks pointing at the same binary produce the same hash.
      // ELOOP (circular symlinks) and other resolution errors → skip entry.
      const resolved = await this.realpath(path);
      const buf = await this.readFile(resolved);
      return createHash("sha256").update(buf).digest("hex");
    } catch {
      return null;
    }
  }
}
