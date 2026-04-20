import { promises as fs } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Snapshot, SNAPSHOT_SIZE_LIMIT } from "../src/snapshot.js";
import { makeGlobalRoot, makeTempDir } from "./helpers/fixtures.js";

describe("Snapshot.capture", () => {
  it("captures plugins, commands, hooks, skills, agents, MCP servers, and PATH", async () => {
    const globalRoot = await makeGlobalRoot(
      [
        {
          name: "plugin-a",
          commands: ["scan.md"],
          hookEvents: {
            PostToolUse: [
              {
                matcher: "*",
                hooks: [
                  {
                    type: "command",
                    command: "node hooks/hook-a.mjs",
                    timeout: 5000,
                  },
                ],
              },
            ],
          },
          hookScripts: { "hooks/hook-a.mjs": "updatedInput = {x:1}\n" },
          skills: [{ name: "skill-a", triggers: ["foo", "bar"] }],
          agents: ["agent-a"],
          mcpServers: { github: { tools: ["issues", "prs"] } },
        },
      ],
      { settingsMcpServers: { linear: { tools: ["query"] } } },
    );

    const pathDir = await makeTempDir("pathfix-");
    await fs.writeFile(join(pathDir, "mytool"), "#!/bin/sh\n", "utf8");

    const snap = new Snapshot({
      globalRoot,
      pathOverride: pathDir,
      // Isolate test from real ~/.claude.json and OS managed-settings leak.
      homeMcpConfigPath: "/nonexistent/claudit-test-home.json",
      managedSettingsPath: null,
    });
    const data = await snap.capture();

    expect(data.plugins).toHaveLength(1);
    const p = data.plugins[0];
    expect(p.name).toBe("plugin-a");
    expect(p.commands.map((c) => c.name)).toEqual(["scan"]);
    expect(Object.keys(p.hookEvents)).toEqual(["PostToolUse"]);
    expect(p.hookEvents.PostToolUse[0].hooks[0].scriptSource).toContain(
      "updatedInput",
    );
    expect(p.skills.map((s) => s.name)).toEqual(["skill-a"]);
    expect(p.skills[0].triggerKeywords).toEqual(["foo", "bar"]);
    expect(p.agents.map((a) => a.name)).toEqual(["agent-a"]);
    expect(p.mcpServers.map((m) => m.name)).toEqual(["github"]);

    expect(data.settingsMcpServers.map((m) => m.name)).toEqual(["linear"]);
    expect(data.pathBinaries.mytool).toEqual([join(pathDir, "mytool")]);
    expect(data.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it("captures project-level plugins when projectRoot is supplied", async () => {
    const globalRoot = await makeGlobalRoot([]);
    const projectRoot = await makeGlobalRoot([
      { name: "plugin-proj", commands: ["build.md"] },
    ]);
    const snap = new Snapshot({ globalRoot, projectRoot, pathOverride: "" });
    const data = await snap.capture();
    expect(data.plugins.map((p) => p.name)).toEqual(["plugin-proj"]);
  });

  it("handles a missing plugins directory without throwing", async () => {
    const empty = await makeTempDir("empty-root-");
    const snap = new Snapshot({
      globalRoot: empty,
      pathOverride: "",
      homeMcpConfigPath: "/nonexistent/claudit-test-home.json",
      managedSettingsPath: null,
    });
    const data = await snap.capture();
    expect(data.plugins).toEqual([]);
    expect(data.settingsMcpServers).toEqual([]);
  });
});

describe("Snapshot.diff", () => {
  it("classifies added / removed / modified plugins", async () => {
    const prevRoot = await makeGlobalRoot([
      { name: "shared", commands: ["a.md"] },
      { name: "gone", commands: ["b.md"] },
    ]);
    const prevData = await new Snapshot({
      globalRoot: prevRoot,
      pathOverride: "",
    }).capture();

    const currRoot = await makeGlobalRoot([
      { name: "shared", commands: ["a.md", "c.md"] }, // modified
      { name: "new", commands: ["d.md"] },             // added
    ]);
    const currData = await new Snapshot({
      globalRoot: currRoot,
      pathOverride: "",
    }).capture();

    const diff = Snapshot.diff(prevData, currData);
    expect(diff.plugins.added.map((p) => p.name)).toEqual(["new"]);
    expect(diff.plugins.removed.map((p) => p.name)).toEqual(["gone"]);
    expect(diff.plugins.modified.map((m) => m.after.name)).toEqual(["shared"]);
    expect(diff.hasChanges).toBe(true);
  });

  it("reports no changes when snapshots are identical", async () => {
    const root = await makeGlobalRoot([{ name: "same", commands: ["x.md"] }]);
    const a = await new Snapshot({ globalRoot: root, pathOverride: "" }).capture();
    const b = await new Snapshot({ globalRoot: root, pathOverride: "" }).capture();
    // fingerprints differ by capturedAt; but diff compares plugin structure.
    const diff = Snapshot.diff(a, b);
    expect(diff.plugins.added).toEqual([]);
    expect(diff.plugins.removed).toEqual([]);
    expect(diff.plugins.modified).toEqual([]);
    expect(diff.hasChanges).toBe(false);
  });

  it("tracks added and removed PATH binaries", async () => {
    const dir1 = await makeTempDir("patha-");
    await fs.writeFile(join(dir1, "alpha"), "", "utf8");
    const dir2 = await makeTempDir("pathb-");
    await fs.writeFile(join(dir2, "beta"), "", "utf8");

    const prev = await new Snapshot({
      globalRoot: await makeTempDir("gr-"),
      pathOverride: dir1,
    }).capture();
    const curr = await new Snapshot({
      globalRoot: await makeTempDir("gr-"),
      pathOverride: dir2,
    }).capture();
    const diff = Snapshot.diff(prev, curr);
    expect(Object.keys(diff.pathBinaries.added)).toEqual(["beta"]);
    expect(Object.keys(diff.pathBinaries.removed)).toEqual(["alpha"]);
  });
});

describe("Snapshot.save / load / prune", () => {
  let storageRoot: string;
  let globalRoot: string;
  beforeEach(async () => {
    storageRoot = await makeTempDir("snap-store-");
    globalRoot = await makeGlobalRoot([
      { name: "p1", commands: ["one.md"] },
    ]);
  });

  it("save() writes to storageRoot and load() round-trips", async () => {
    const snap = new Snapshot({
      globalRoot,
      pathOverride: "",
      storageRoot,
    });
    await snap.capture();
    const savedPath = await snap.save();
    const loaded = await Snapshot.load(savedPath);
    expect(loaded.data.fingerprint).toBe(snap.data.fingerprint);
    expect(loaded.data.plugins.map((p) => p.name)).toEqual(["p1"]);
  });

  it("keeps at most 2 snapshot files after 3 sequential saves", async () => {
    for (let i = 0; i < 3; i++) {
      const snap = new Snapshot({
        globalRoot,
        pathOverride: "",
        storageRoot,
      });
      await snap.capture();
      await snap.save();
      await new Promise((r) => setTimeout(r, 10));
    }
    const files = (await fs.readdir(storageRoot)).filter((f) =>
      f.startsWith("snapshot-"),
    );
    expect(files.length).toBeLessThanOrEqual(2);
  });

  it("stays under 1MB for a 10-plugin fixture", async () => {
    const roots = Array.from({ length: 10 }, (_, i) => ({
      name: `p${i}`,
      commands: [`cmd-${i}.md`],
      hookEvents: {
        PostToolUse: [
          {
            matcher: "*",
            hooks: [
              {
                type: "command",
                command: `node hooks/h${i}.mjs`,
                timeout: 5000,
              },
            ],
          },
        ],
      },
      hookScripts: { [`hooks/h${i}.mjs`]: "console.log('hi')\n" },
    }));
    const root = await makeGlobalRoot(roots);
    const snap = new Snapshot({
      globalRoot: root,
      pathOverride: "",
      storageRoot,
    });
    await snap.capture();
    const savedPath = await snap.save();
    const size = (await fs.stat(savedPath)).size;
    expect(size).toBeLessThan(SNAPSHOT_SIZE_LIMIT);
  });
});
