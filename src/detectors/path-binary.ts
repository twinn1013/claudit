import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
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
  /** Override allowlist. Defaults to BENIGN_SYSTEM_BINARIES. */
  allowlist?: ReadonlySet<string>;
}

export class PathBinaryDetector implements Detector {
  readonly category = "path-binary" as const;

  private readonly readFile: (path: string) => Promise<Buffer>;
  private readonly allowlist: ReadonlySet<string>;

  constructor(options: PathBinaryDetectorOptions = {}) {
    this.readFile = options.readFile ?? ((p) => fs.readFile(p));
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
      const uniqueHashes = new Set(
        hashes.map((h) => h.hash).filter((h): h is string => h !== null),
      );
      const anyUnreadable = hashes.some((h) => h.hash === null);

      let confidence: Collision["confidence"];
      let message: string;
      if (!anyUnreadable && uniqueHashes.size === 1) {
        // all copies byte-identical (likely hard link / build artifact dupe) — skip
        continue;
      } else if (!anyUnreadable) {
        confidence = "definite";
        message = `Binary "${name}" appears at ${paths.length} PATH locations with ${uniqueHashes.size} distinct contents — earlier PATH entries shadow later ones.`;
      } else if (uniqueHashes.size >= 2) {
        confidence = "definite";
        message = `Binary "${name}" appears at ${paths.length} PATH locations with at least ${uniqueHashes.size} distinct contents (some copies could not be hashed).`;
      } else {
        confidence = "possible";
        message = `Binary "${name}" appears at ${paths.length} PATH locations; content comparison was not possible.`;
      }

      collisions.push({
        category: "path-binary",
        severity: "warning",
        confidence,
        entities_involved: paths,
        suggested_fix: [
          {
            command: `which -a ${name}`,
            scope: "shell",
            safety_level: "safe",
            rationale: "List every copy on your PATH to decide which to keep.",
          },
          {
            command: `# remove the unwanted copy of ${name} or adjust PATH order`,
            scope: "shell",
            safety_level: "manual-review",
            rationale: `Differing copies of "${name}" typically indicate a name collision between an OS package and a language-specific install (e.g. cargo, brew, pipx).`,
          },
        ],
        message,
      });
    }
    return collisions;
  }

  private async safeHash(path: string): Promise<string | null> {
    try {
      const buf = await this.readFile(path);
      return createHash("sha256").update(buf).digest("hex");
    } catch {
      return null;
    }
  }
}
