/**
 * Cross-detector namespace-aware semantics tests (Stage 3, plan line 223).
 *
 * Uses directly-constructed SnapshotData so enabled: false can be set without
 * going through the snapshot pipeline.
 */
import { describe, expect, it } from "vitest";
import { SlashCommandDetector } from "../../src/detectors/slash-command.js";
import { SkillNameDetector } from "../../src/detectors/skill-name.js";
import { SubagentTypeDetector } from "../../src/detectors/subagent-type.js";
import type { SnapshotData, PluginSummary } from "../../src/types.js";

function makeSnapshot(plugins: Partial<PluginSummary>[]): SnapshotData {
  const defaults: Omit<PluginSummary, "name" | "pluginRoot"> = {
    hookEvents: {},
    commands: [],
    skills: [],
    agents: [],
    mcpServers: [],
    source: "plugin-cache",
    enabled: true,
  };
  return {
    globalRoot: "/fake",
    plugins: plugins.map((p, i) => ({
      ...defaults,
      name: `plugin-${i}`,
      pluginRoot: `/fake/plugin-${i}`,
      ...p,
    })),
    settingsMcpServers: [],
    projectMcpServers: [],
    settingsHooks: [],
    pathBinaries: {},
    capturedAt: new Date().toISOString(),
    fingerprint: "test",
  };
}

describe("namespace-aware: slash-command", () => {
  it("two enabled plugins defining /scan → info/possible with disambiguation", async () => {
    const data = makeSnapshot([
      { name: "plugin-a", pluginRoot: "/a", commands: [{ name: "scan" }] },
      { name: "plugin-b", pluginRoot: "/b", commands: [{ name: "scan" }] },
    ]);
    const collisions = await new SlashCommandDetector().analyze(data);
    expect(collisions).toHaveLength(1);
    expect(collisions[0].severity).toBe("info");
    expect(collisions[0].confidence).toBe("possible");
    expect(collisions[0].message).toContain("/plugin-a:scan");
    expect(collisions[0].message).toContain("/plugin-b:scan");
  });

  it("one enabled + one disabled → possible, message mentions disabled", async () => {
    const data = makeSnapshot([
      { name: "plugin-a", pluginRoot: "/a", commands: [{ name: "scan" }], enabled: true },
      { name: "plugin-b", pluginRoot: "/b", commands: [{ name: "scan" }], enabled: false },
    ]);
    const collisions = await new SlashCommandDetector().analyze(data);
    expect(collisions).toHaveLength(1);
    expect(collisions[0].confidence).toBe("possible");
    expect(collisions[0].message.toLowerCase()).toContain("disabled");
    expect(collisions[0].message).toContain("plugin-b");
  });

  it("same plugin name across marketplaces stays distinct in entities", async () => {
    const data = makeSnapshot([
      {
        name: "foo",
        marketplace: "alpha",
        pluginRoot: "/plugins/cache/alpha/foo/1.0.0",
        commands: [{ name: "scan" }],
      },
      {
        name: "foo",
        marketplace: "beta",
        pluginRoot: "/plugins/cache/beta/foo/1.0.0",
        commands: [{ name: "scan" }],
      },
    ]);
    const collisions = await new SlashCommandDetector().analyze(data);
    expect(collisions).toHaveLength(1);
    expect(collisions[0].entities_involved).toEqual([
      "foo@alpha:/scan",
      "foo@beta:/scan",
    ]);
    expect(collisions[0].message).toContain("foo@alpha");
    expect(collisions[0].message).toContain("foo@beta");
  });
});

describe("namespace-aware: skill-name", () => {
  it("two enabled plugins defining skill 'deep-dive' → info/possible with disambiguation", async () => {
    const data = makeSnapshot([
      { name: "plugin-a", pluginRoot: "/a", skills: [{ name: "deep-dive", triggerKeywords: [] }] },
      { name: "plugin-b", pluginRoot: "/b", skills: [{ name: "deep-dive", triggerKeywords: [] }] },
    ]);
    const collisions = await new SkillNameDetector().analyze(data);
    const nameCols = collisions.filter((c) => !c.entities_involved[0].includes(":trigger:"));
    expect(nameCols).toHaveLength(1);
    expect(nameCols[0].severity).toBe("info");
    expect(nameCols[0].confidence).toBe("possible");
    expect(nameCols[0].message).toContain("plugin-a:deep-dive");
    expect(nameCols[0].message).toContain("plugin-b:deep-dive");
  });

  it("same plugin name across marketplaces stays distinct for skill collisions", async () => {
    const data = makeSnapshot([
      {
        name: "foo",
        marketplace: "alpha",
        pluginRoot: "/plugins/cache/alpha/foo/1.0.0",
        skills: [{ name: "deep-dive", triggerKeywords: [] }],
      },
      {
        name: "foo",
        marketplace: "beta",
        pluginRoot: "/plugins/cache/beta/foo/1.0.0",
        skills: [{ name: "deep-dive", triggerKeywords: [] }],
      },
    ]);
    const collisions = await new SkillNameDetector().analyze(data);
    const nameCols = collisions.filter((c) => !c.entities_involved[0].includes(":trigger:"));
    expect(nameCols).toHaveLength(1);
    expect(nameCols[0].entities_involved).toEqual([
      "foo@alpha:skill:deep-dive",
      "foo@beta:skill:deep-dive",
    ]);
  });
});

describe("namespace-aware: subagent-type", () => {
  it("two enabled plugins defining agent 'code-reviewer' → info/possible with disambiguation", async () => {
    const data = makeSnapshot([
      { name: "plugin-a", pluginRoot: "/a", agents: [{ name: "code-reviewer" }] },
      { name: "plugin-b", pluginRoot: "/b", agents: [{ name: "code-reviewer" }] },
    ]);
    const collisions = await new SubagentTypeDetector().analyze(data);
    expect(collisions).toHaveLength(1);
    expect(collisions[0].severity).toBe("info");
    expect(collisions[0].confidence).toBe("possible");
    expect(collisions[0].message).toContain("plugin-a:code-reviewer");
    expect(collisions[0].message).toContain("plugin-b:code-reviewer");
  });

  it("same plugin name across marketplaces stays distinct for agent collisions", async () => {
    const data = makeSnapshot([
      {
        name: "foo",
        marketplace: "alpha",
        pluginRoot: "/plugins/cache/alpha/foo/1.0.0",
        agents: [{ name: "code-reviewer" }],
      },
      {
        name: "foo",
        marketplace: "beta",
        pluginRoot: "/plugins/cache/beta/foo/1.0.0",
        agents: [{ name: "code-reviewer" }],
      },
    ]);
    const collisions = await new SubagentTypeDetector().analyze(data);
    expect(collisions).toHaveLength(1);
    expect(collisions[0].entities_involved).toEqual([
      "foo@alpha:agent:code-reviewer",
      "foo@beta:agent:code-reviewer",
    ]);
  });
});

describe("namespace-aware: cross-detector safety assertions", () => {
  const DETECTORS = [
    new SlashCommandDetector(),
    new SkillNameDetector(),
    new SubagentTypeDetector(),
  ];

  it("no collision across any detector has a destructive FixSuggestion", async () => {
    const data = makeSnapshot([
      {
        name: "plugin-a",
        pluginRoot: "/a",
        commands: [{ name: "scan" }],
        skills: [{ name: "deep-dive", triggerKeywords: ["deep dive"] }],
        agents: [{ name: "code-reviewer" }],
      },
      {
        name: "plugin-b",
        pluginRoot: "/b",
        commands: [{ name: "scan" }],
        skills: [{ name: "deep-dive", triggerKeywords: ["deep dive"] }],
        agents: [{ name: "code-reviewer" }],
      },
    ]);
    for (const detector of DETECTORS) {
      const collisions = await detector.analyze(data);
      for (const col of collisions) {
        for (const fix of col.suggested_fix) {
          expect(fix.safety_level).not.toBe("destructive");
        }
      }
    }
  });

  it("no collision across any detector has a FixSuggestion with # in the command", async () => {
    const data = makeSnapshot([
      {
        name: "plugin-a",
        pluginRoot: "/a",
        commands: [{ name: "scan" }],
        skills: [{ name: "deep-dive", triggerKeywords: [] }],
        agents: [{ name: "code-reviewer" }],
      },
      {
        name: "plugin-b",
        pluginRoot: "/b",
        commands: [{ name: "scan" }],
        skills: [{ name: "deep-dive", triggerKeywords: [] }],
        agents: [{ name: "code-reviewer" }],
      },
    ]);
    for (const detector of DETECTORS) {
      const collisions = await detector.analyze(data);
      for (const col of collisions) {
        for (const fix of col.suggested_fix) {
          expect(fix.command).not.toContain("#");
        }
      }
    }
  });
});
