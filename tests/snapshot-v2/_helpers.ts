import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Create a unique temp dir. */
export async function mkTmp(prefix = "claudit-v2-"): Promise<string> {
  return fs.mkdtemp(join(tmpdir(), prefix));
}

/** Recursively ensure a directory exists. */
export async function mkdirp(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

/** Write a JSON file (parents created as needed). */
export async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdirp(join(path, ".."));
  await fs.writeFile(path, JSON.stringify(value, null, 2), "utf8");
}

/** Write a text file (parents created as needed). */
export async function writeText(path: string, text: string): Promise<void> {
  await mkdirp(join(path, ".."));
  await fs.writeFile(path, text, "utf8");
}

/**
 * Build isolation options so Snapshot does not read the real
 * ~/.claude.json or the OS managed-settings path during unit tests.
 */
export function isolated(): {
  homeMcpConfigPath: string;
  managedSettingsPath: null;
} {
  return {
    homeMcpConfigPath: "/nonexistent/claudit-v2-home.json",
    managedSettingsPath: null,
  };
}
