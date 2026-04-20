/**
 * Tests that the skill trigger-overlap detector correctly handles triggerKeywords
 * produced by the YAML block-list parser (Stage 1).
 *
 * We construct SnapshotData directly so that triggerKeywords reflect what the
 * YAML parser produces from block-list frontmatter:
 *   triggers:
 *     - "deep dive"
 *     - "deep-dive"
 */
import { describe, expect, it } from "vitest";
import { SkillNameDetector } from "../../src/detectors/skill-name.js";
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
    settingsHooks: [],
    pathBinaries: {},
    capturedAt: new Date().toISOString(),
    fingerprint: "test",
  };
}

describe("SkillNameDetector — YAML block-list trigger keywords", () => {
  it("detects trigger overlap when both skills share a block-list keyword 'deep dive'", async () => {
    // Plugin A skill "deep-dive" has block-list triggers: ["deep dive", "deep-dive"]
    // Plugin B skill "analyze" has block-list triggers: ["deep dive", "analyze"]
    // Shared keyword: "deep dive"
    const data = makeSnapshot([
      {
        name: "plugin-a",
        pluginRoot: "/a",
        skills: [
          {
            name: "deep-dive",
            triggerKeywords: ["deep dive", "deep-dive"],
          },
        ],
      },
      {
        name: "plugin-b",
        pluginRoot: "/b",
        skills: [
          {
            name: "analyze",
            triggerKeywords: ["deep dive", "analyze"],
          },
        ],
      },
    ]);

    const collisions = await new SkillNameDetector().analyze(data);

    // Should find the trigger overlap on "deep dive".
    const triggerCols = collisions.filter((c) =>
      c.entities_involved.some((e) => e.includes(":trigger:")),
    );
    expect(triggerCols).toHaveLength(1);
    expect(triggerCols[0].severity).toBe("info");
    expect(triggerCols[0].confidence).toBe("possible");

    // entities_involved must name both skills and the shared keyword.
    expect(triggerCols[0].entities_involved).toEqual(
      expect.arrayContaining([
        "plugin-a:skill:deep-dive:trigger:deep dive",
        "plugin-b:skill:analyze:trigger:deep dive",
      ]),
    );

    // Message should reference "deep dive".
    expect(triggerCols[0].message).toContain("deep dive");
  });

  it("does not flag a block-list keyword that appears in only one plugin", async () => {
    const data = makeSnapshot([
      {
        name: "plugin-a",
        pluginRoot: "/a",
        skills: [
          {
            name: "deep-dive",
            triggerKeywords: ["deep dive", "deep-dive"],
          },
        ],
      },
      {
        name: "plugin-b",
        pluginRoot: "/b",
        skills: [
          {
            name: "analyze",
            triggerKeywords: ["analyze", "inspect"],
          },
        ],
      },
    ]);

    const collisions = await new SkillNameDetector().analyze(data);
    const triggerCols = collisions.filter((c) =>
      c.entities_involved.some((e) => e.includes(":trigger:")),
    );
    expect(triggerCols).toHaveLength(0);
  });

  it("trigger-overlap collisions have no # comment in suggested_fix commands", async () => {
    const data = makeSnapshot([
      {
        name: "plugin-a",
        pluginRoot: "/a",
        skills: [{ name: "x", triggerKeywords: ["shared"] }],
      },
      {
        name: "plugin-b",
        pluginRoot: "/b",
        skills: [{ name: "y", triggerKeywords: ["shared"] }],
      },
    ]);

    const collisions = await new SkillNameDetector().analyze(data);
    for (const col of collisions) {
      for (const fix of col.suggested_fix) {
        expect(fix.command).not.toContain("#");
      }
    }
  });
});
