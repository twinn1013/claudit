import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Report } from "../src/report.js";
import { Scanner } from "../src/scanner.js";
import { defaultGlobalRoot, Snapshot } from "../src/snapshot.js";
import { main as sessionStart } from "../src/hooks/session-start.js";
import { writePendingMarker } from "../src/pending.js";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

interface HooksJson {
  hooks: Record<
    string,
    Array<{
      matcher?: string;
      hooks: Array<{ type: string; command: string; timeout?: number }>;
    }>
  >;
}

describe("ralph-verify v2 — criterion 1: install verification", () => {
  it("verifies hooks metadata, plugin.json commands, dist outputs, and build success", async () => {
    const hooksRaw = await fs.readFile(join(repoRoot, "hooks", "hooks.json"), "utf8");
    const hooks = JSON.parse(hooksRaw) as HooksJson;
    expect(Object.keys(hooks.hooks).sort()).toEqual(["PostToolUse", "SessionStart"]);

    const distTargets = new Set<string>();
    for (const entries of Object.values(hooks.hooks)) {
      for (const entry of entries) {
        expect(entry.matcher).toBe("*");
        for (const hook of entry.hooks) {
          expect(hook.type).toBe("command");
          expect(typeof hook.command).toBe("string");
          expect(typeof hook.timeout).toBe("number");
          const match = hook.command.match(/dist\/hooks\/[^"]+\.mjs/);
          expect(match).not.toBeNull();
          distTargets.add(match![0]!);
        }
      }
    }

    const pluginRaw = await fs.readFile(
      join(repoRoot, ".claude-plugin", "plugin.json"),
      "utf8",
    );
    const plugin = JSON.parse(pluginRaw) as { commands?: unknown };
    expect(Array.isArray(plugin.commands)).toBe(true);

    const build = await execFileAsync("npm", ["run", "build"], {
      cwd: repoRoot,
      env: process.env,
    });
    expect(build.stderr ?? "").not.toContain("Build failed");
    for (const relative of distTargets) {
      const stat = await fs.stat(join(repoRoot, relative));
      expect(stat.isFile()).toBe(true);
    }
    const scannerStat = await fs.stat(join(repoRoot, "dist", "scanner.mjs"));
    expect(scannerStat.isFile()).toBe(true);
  });
});

describe("ralph-verify v2 — criterion 2: namespace verification", () => {
  it("enumerates installed plugins and finds no intersection with claudit's identifiers", async () => {
    const snapshot = await new Snapshot({
      globalRoot: defaultGlobalRoot(),
      pathOverride: "",
    }).capture();

    const clauditIdentifiers = new Set(["claudit", "scan"]);
    const intersections = new Set<string>();
    for (const plugin of snapshot.plugins) {
      if (plugin.name === "claudit") intersections.add("plugin:claudit");
      for (const command of plugin.commands) {
        if (clauditIdentifiers.has(command.name)) {
          intersections.add(`command:${plugin.qualifiedName ?? plugin.name}:${command.name}`);
        }
      }
      for (const skill of plugin.skills) {
        if (clauditIdentifiers.has(skill.name)) {
          intersections.add(`skill:${plugin.qualifiedName ?? plugin.name}:${skill.name}`);
        }
      }
      for (const agent of plugin.agents) {
        if (clauditIdentifiers.has(agent.name)) {
          intersections.add(`agent:${plugin.qualifiedName ?? plugin.name}:${agent.name}`);
        }
      }
      for (const server of plugin.mcpServers) {
        if (clauditIdentifiers.has(server.name)) {
          intersections.add(`mcp:${plugin.qualifiedName ?? plugin.name}:${server.name}`);
        }
      }
    }

    expect([...intersections]).toEqual([]);
  });
});

describe("ralph-verify v2 — criterion 3: idempotency", () => {
  it("builds twice with byte-identical dist output, keeps two hooks entries, and prunes snapshots to 2", async () => {
    await execFileAsync("npm", ["run", "build"], { cwd: repoRoot, env: process.env });
    const firstHash = await hashTree(join(repoRoot, "dist"));
    await execFileAsync("npm", ["run", "build"], { cwd: repoRoot, env: process.env });
    const secondHash = await hashTree(join(repoRoot, "dist"));
    expect(firstHash).toBe(secondHash);

    const hooksRaw = await fs.readFile(join(repoRoot, "hooks", "hooks.json"), "utf8");
    const hooks = JSON.parse(hooksRaw) as HooksJson;
    expect(Object.keys(hooks.hooks)).toHaveLength(2);

    const globalRoot = await mkTmp("ralph-session-global-");
    await fs.mkdir(join(globalRoot, "plugins"), { recursive: true });
    const storageRoot = await mkTmp("ralph-session-storage-");
    const pendingDir = await mkTmp("ralph-session-pending-");

    for (let i = 0; i < 3; i++) {
      await writePendingMarker({
        dir: pendingDir,
        marker: {
          timestamp: new Date(2026, 3, 20, 12, 0, i).toISOString(),
          trigger: "PostToolUse",
          command: "brew install ripgrep",
          matched_pattern: "\\bbrew install\\s+\\S",
        },
      });
      await withCapturedStdout(async () => {
        await sessionStart({
          stdin: "{}",
          globalRoot,
          pathOverride: "",
          pendingDir,
          storageRoot,
        });
      });
    }

    const snapshots = (await fs.readdir(storageRoot)).filter((name) =>
      name.endsWith(".json"),
    );
    expect(snapshots.length).toBeLessThanOrEqual(2);
  });
});

describe("ralph-verify v2 — criterion 4: multi-source hook detection", () => {
  it("proves definite cross-source collision and possible disabled-plugin collision", async () => {
    const fixtureRoot = await mkTmp("ralph-multisource-");
    const pluginRoot = join(
      fixtureRoot,
      "plugins",
      "cache",
      "omc",
      "oh-my-claudecode",
      "4.11.6",
    );

    await writeJson(join(fixtureRoot, "settings.json"), {
      hooks: {
        PreToolUse: [
          {
            matcher: "*",
            hooks: [{ type: "command", command: "rtk hook claude" }],
          },
        ],
      },
      enabledPlugins: {
        "oh-my-claudecode@omc": false,
      },
    });
    await writeJson(join(pluginRoot, ".claude-plugin", "plugin.json"), {
      name: "oh-my-claudecode",
      version: "4.11.6",
    });
    await writeJson(join(pluginRoot, "hooks", "hooks.json"), {
      hooks: {
        PreToolUse: [
          {
            matcher: "*",
            hooks: [{ type: "command", command: "node hooks/pretooluse.mjs" }],
          },
        ],
      },
    });
    await writeText(
      join(pluginRoot, "hooks", "pretooluse.mjs"),
      "updatedInput.command = `omx ${updatedInput.command}`;\nconsole.log(JSON.stringify({ hookSpecificOutput: { updatedInput } }));\n",
    );

    const snapshot = await new Snapshot({
      globalRoot: fixtureRoot,
      pathOverride: "",
      homeMcpConfigPath: "/nonexistent/ralph-verify-home.json",
      managedSettingsPath: null,
    }).capture();
    const report = await new Scanner({ detectorTimeoutMs: 500 }).run(snapshot);
    const hookCollisions = report.collisions.filter(
      (collision) => collision.category === "hook-matcher",
    );

    expect(
      hookCollisions.some(
        (collision) =>
          collision.confidence === "possible" &&
          collision.entities_involved.includes("user-settings:PreToolUse:*") &&
          collision.entities_involved.includes("oh-my-claudecode@omc:PreToolUse:*") &&
          collision.message.toLowerCase().includes("disabled"),
      ),
    ).toBe(true);

    await writeJson(join(fixtureRoot, "settings.json"), {
      hooks: {
        PreToolUse: [
          {
            matcher: "*",
            hooks: [{ type: "command", command: "rtk hook claude" }],
          },
        ],
      },
      enabledPlugins: {
        "oh-my-claudecode@omc": true,
      },
    });
    const activeSnapshot = await new Snapshot({
      globalRoot: fixtureRoot,
      pathOverride: "",
      homeMcpConfigPath: "/nonexistent/ralph-verify-home.json",
      managedSettingsPath: null,
    }).capture();
    const activeReport = await new Scanner({ detectorTimeoutMs: 500 }).run(activeSnapshot);
    expect(
      activeReport.collisions.some(
        (collision) =>
          collision.category === "hook-matcher" &&
          collision.confidence === "definite" &&
          collision.entities_involved.includes("user-settings:PreToolUse:*") &&
          collision.entities_involved.includes("oh-my-claudecode@omc:PreToolUse:*"),
      ),
    ).toBe(true);
  });
});

describe("ralph-verify v2 — criterion 5: flagship scenario", () => {
  it("round-trips the real RTK+OMC fixture through Snapshot -> Scanner -> Report", async () => {
    const fixtureRoot = fileURLToPath(
      new URL("./e2e/fixtures/rtk-omc", import.meta.url),
    );
    const snapshot = await new Snapshot({
      globalRoot: fixtureRoot,
      pathOverride: "",
      homeMcpConfigPath: "/nonexistent/ralph-verify-home.json",
      managedSettingsPath: null,
    }).capture();
    const report = await new Scanner({ detectorTimeoutMs: 500 }).run(snapshot);
    const parsed = Report.parse(report.serialize());
    expect(
      parsed.collisions.some((collision) => collision.category === "hook-matcher"),
    ).toBe(true);
    expect(parsed.data).toEqual(report.data);
  });
});

describe("ralph-verify v2 — criterion 6: v0.1 regression floor", () => {
  it("runs the legacy subset and keeps the committed regression floor", async () => {
    const command =
      "find tests -type f -name '*.test.ts' ! -path 'tests/snapshot-v2/*' ! -path 'tests/e2e/*' ! -name '*-v2.test.ts' | sort | xargs npx vitest run";
    const { stdout, stderr } = await execFileAsync("/bin/sh", ["-lc", command], {
      cwd: repoRoot,
      env: process.env,
      maxBuffer: 1024 * 1024,
    });

    const combined = `${stdout}\n${stderr}`;
    const passed = Number(combined.match(/Tests\s+(\d+)\s+passed/)?.[1] ?? "0");
    expect(passed).toBeGreaterThanOrEqual(100);

    const migrationNotes = join(repoRoot, "tests", "v0.1-migration-notes.md");
    const hasMigrationNotes = await fs
      .stat(migrationNotes)
      .then(() => true)
      .catch(() => false);
    expect(hasMigrationNotes).toBe(false);
  });
});

async function hashTree(root: string): Promise<string> {
  const hash = createHash("sha256");
  const entries = await walkFiles(root);
  for (const entry of entries) {
    hash.update(entry);
    hash.update(await fs.readFile(entry));
  }
  return hash.digest("hex");
}

async function walkFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  for (const name of (await fs.readdir(root)).sort()) {
    const full = join(root, name);
    const stat = await fs.stat(full);
    if (stat.isDirectory()) out.push(...(await walkFiles(full)));
    else out.push(full);
  }
  return out;
}

async function mkTmp(prefix: string): Promise<string> {
  return fs.mkdtemp(join(tmpdir(), prefix));
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true });
  await fs.writeFile(path, JSON.stringify(value, null, 2), "utf8");
}

async function writeText(path: string, text: string): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true });
  await fs.writeFile(path, text, "utf8");
}

async function withCapturedStdout<T>(fn: () => Promise<T>): Promise<T> {
  const original = process.stdout.write.bind(process.stdout);
  (process.stdout.write as unknown as (chunk: unknown) => boolean) = () => true;
  try {
    return await fn();
  } finally {
    (process.stdout.write as unknown as typeof original) = original;
  }
}
