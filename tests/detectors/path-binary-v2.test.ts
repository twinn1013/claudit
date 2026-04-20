import type { Stats } from "node:fs";
import { describe, expect, it } from "vitest";
import { PathBinaryDetector } from "../../src/detectors/path-binary.js";
import type { SnapshotData } from "../../src/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fakeStats({ file = true, mode = 0o755 }: { file?: boolean; mode?: number } = {}): Stats {
  return { isFile: () => file, mode } as unknown as Stats;
}

/** Build a minimal SnapshotData with only pathBinaries populated. */
function makeSnapshot(pathBinaries: Record<string, string[]>): SnapshotData {
  return {
    pathBinaries,
    schemaVersion: 2,
    capturedAt: new Date().toISOString(),
    fingerprint: "test",
    settingsHooks: [],
    commands: [],
    skills: [],
    agents: [],
    mcpServers: [],
    plugins: [],
    enabledPlugins: {},
    pluginCommands: [],
    pluginMcpServers: [],
    pluginHooks: [],
  } as unknown as SnapshotData;
}

// ---------------------------------------------------------------------------
// Stage 5 exit criteria
// ---------------------------------------------------------------------------

describe("PathBinaryDetector v2 — executable filter", () => {
  it("excludes non-executable file: only 1 exec remains → no collision", async () => {
    // foo at /a/foo (mode 0o644, non-exec) and /b/foo (mode 0o755, exec)
    const statMap: Record<string, Stats> = {
      "/a/foo": fakeStats({ mode: 0o644 }),
      "/b/foo": fakeStats({ mode: 0o755 }),
    };
    const contentMap: Record<string, Buffer> = {
      "/b/foo": Buffer.from("exec content"),
    };

    const detector = new PathBinaryDetector({
      stat: async (p) => statMap[p]!,
      realpath: async (p) => p,
      readFile: async (p) => contentMap[p] ?? Buffer.from(""),
      allowlist: new Set(),
    });

    const data = makeSnapshot({ foo: ["/a/foo", "/b/foo"] });
    const collisions = await detector.analyze(data);
    expect(collisions).toEqual([]);
  });

  it("non-exec filtered: 2 exec copies with different content → definite collision", async () => {
    // foo at 3 paths — 1 non-exec, 2 exec with different content
    const statMap: Record<string, Stats> = {
      "/a/foo": fakeStats({ mode: 0o644 }), // non-exec
      "/b/foo": fakeStats({ mode: 0o755 }),
      "/c/foo": fakeStats({ mode: 0o755 }),
    };
    const contentMap: Record<string, Buffer> = {
      "/b/foo": Buffer.from("version-b"),
      "/c/foo": Buffer.from("version-c"),
    };

    const detector = new PathBinaryDetector({
      stat: async (p) => statMap[p]!,
      realpath: async (p) => p,
      readFile: async (p) => contentMap[p] ?? Buffer.from(""),
      allowlist: new Set(),
    });

    const data = makeSnapshot({ foo: ["/a/foo", "/b/foo", "/c/foo"] });
    const collisions = await detector.analyze(data);
    expect(collisions).toHaveLength(1);
    expect(collisions[0].confidence).toBe("definite");
    expect(collisions[0].entities_involved.sort()).toEqual(["/b/foo", "/c/foo"].sort());
  });
});

describe("PathBinaryDetector v2 — symlink follow", () => {
  it("symlink to valid executable: both resolve to same target → no collision (byte-identical)", async () => {
    // /a/foo is a regular file, /b/foo is a symlink pointing at /a/foo
    const statMap: Record<string, Stats> = {
      "/a/foo": fakeStats({ mode: 0o755 }),
      "/b/foo": fakeStats({ mode: 0o755 }), // stat follows symlink → isFile()=true
    };
    // realpath resolves /b/foo → /a/foo
    const realpathMap: Record<string, string> = {
      "/a/foo": "/a/foo",
      "/b/foo": "/a/foo",
    };
    const contentMap: Record<string, Buffer> = {
      "/a/foo": Buffer.from("real content"),
    };

    const detector = new PathBinaryDetector({
      stat: async (p) => statMap[p]!,
      realpath: async (p) => realpathMap[p] ?? p,
      readFile: async (p) => contentMap[p] ?? Buffer.from(""),
      allowlist: new Set(),
    });

    const data = makeSnapshot({ foo: ["/a/foo", "/b/foo"] });
    const collisions = await detector.analyze(data);
    // Both hash to the same content → skipped as byte-identical
    expect(collisions).toEqual([]);
  });

  it("symlink to different executable: different resolved content → definite collision", async () => {
    // /a/foo is a regular exec (content X), /b/foo is a symlink to /c/bar (content Y)
    const statMap: Record<string, Stats> = {
      "/a/foo": fakeStats({ mode: 0o755 }),
      "/b/foo": fakeStats({ mode: 0o755 }), // stat follows symlink → isFile()=true
    };
    const realpathMap: Record<string, string> = {
      "/a/foo": "/a/foo",
      "/b/foo": "/c/bar",
    };
    const contentMap: Record<string, Buffer> = {
      "/a/foo": Buffer.from("content-x"),
      "/c/bar": Buffer.from("content-y"),
    };

    const detector = new PathBinaryDetector({
      stat: async (p) => statMap[p]!,
      realpath: async (p) => realpathMap[p] ?? p,
      readFile: async (p) => contentMap[p] ?? Buffer.from(""),
      allowlist: new Set(),
    });

    const data = makeSnapshot({ foo: ["/a/foo", "/b/foo"] });
    const collisions = await detector.analyze(data);
    expect(collisions).toHaveLength(1);
    expect(collisions[0].confidence).toBe("definite");
    expect(collisions[0].entities_involved.sort()).toEqual(["/a/foo", "/b/foo"].sort());
  });
});

describe("PathBinaryDetector v2 — symlink loop guard", () => {
  it("ELOOP symlink cycle: entry silently skipped; if only one valid copy remains → no collision", async () => {
    // /a/foo → /b/foo → /a/foo (cycle). /z/foo is a valid exec.
    const statMap: Record<string, Stats> = {
      "/a/foo": fakeStats({ mode: 0o755 }),
      "/z/foo": fakeStats({ mode: 0o755 }),
    };
    const contentMap: Record<string, Buffer> = {
      "/z/foo": Buffer.from("valid"),
    };

    const detector = new PathBinaryDetector({
      stat: async (p) => {
        const s = statMap[p];
        if (!s) throw Object.assign(new Error("ELOOP"), { code: "ELOOP" });
        return s;
      },
      realpath: async (p) => {
        if (p === "/a/foo") throw Object.assign(new Error("ELOOP"), { code: "ELOOP" });
        return p;
      },
      readFile: async (p) => contentMap[p] ?? Buffer.from(""),
      allowlist: new Set(),
    });

    // /a/foo triggers ELOOP in stat → null hash; /z/foo is valid
    // 2 paths in snapshot but only 1 produces a valid hash → below threshold
    const data = makeSnapshot({ foo: ["/a/foo", "/z/foo"] });
    const collisions = await detector.analyze(data);
    expect(collisions).toEqual([]);
  });

  it("ELOOP in realpath: entry silently skipped, no throw or infinite recursion", async () => {
    // stat succeeds but realpath throws ELOOP
    const detector = new PathBinaryDetector({
      stat: async (_p) => fakeStats({ mode: 0o755 }),
      realpath: async (p) => {
        if (p === "/loop/foo") throw Object.assign(new Error("ELOOP"), { code: "ELOOP" });
        return p;
      },
      readFile: async (_p) => Buffer.from("content"),
      allowlist: new Set(),
    });

    const data = makeSnapshot({ foo: ["/loop/foo", "/loop/foo"] });
    // Both entries loop → both null → <2 valid → no collision, no crash
    const collisions = await detector.analyze(data);
    expect(collisions).toEqual([]);
  });
});

describe("PathBinaryDetector v2 — no # comment in FixSuggestion", () => {
  it("no suggested_fix command contains a # character", async () => {
    // Trigger a collision so suggested_fix is populated
    const statMap: Record<string, Stats> = {
      "/a/mytool": fakeStats({ mode: 0o755 }),
      "/b/mytool": fakeStats({ mode: 0o755 }),
    };
    const contentMap: Record<string, Buffer> = {
      "/a/mytool": Buffer.from("v1"),
      "/b/mytool": Buffer.from("v2"),
    };

    const detector = new PathBinaryDetector({
      stat: async (p) => statMap[p]!,
      realpath: async (p) => p,
      readFile: async (p) => contentMap[p] ?? Buffer.from(""),
      allowlist: new Set(),
    });

    const data = makeSnapshot({ mytool: ["/a/mytool", "/b/mytool"] });
    const collisions = await detector.analyze(data);
    expect(collisions).toHaveLength(1);

    for (const collision of collisions) {
      for (const fix of collision.suggested_fix ?? []) {
        expect(fix.command).not.toContain("#");
      }
    }
  });
});
