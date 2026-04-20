// v0.2: same base name across plugins = info/possible per namespace-aware semantics; was definite/warning in v0.1.
import { describe, expect, it } from "vitest";
import { SkillNameDetector } from "../../src/detectors/skill-name.js";
import { Snapshot } from "../../src/snapshot.js";
import { makeGlobalRoot } from "../helpers/fixtures.js";

async function snap(plugins: Parameters<typeof makeGlobalRoot>[0]) {
  const root = await makeGlobalRoot(plugins);
  return await new Snapshot({ globalRoot: root, pathOverride: "" }).capture();
}

describe("SkillNameDetector", () => {
  it("produces an info/possible collision when two plugins both define the same skill name", async () => {
    const data = await snap([
      { name: "plugin-a", skills: [{ name: "deploy" }] },
      { name: "plugin-b", skills: [{ name: "deploy" }] },
    ]);
    const collisions = await new SkillNameDetector().analyze(data);
    const nameCols = collisions.filter((c) => c.confidence === "possible" && !c.entities_involved[0].includes(":trigger:"));
    expect(nameCols).toHaveLength(1);
    expect(nameCols[0].severity).toBe("info");
    expect(nameCols[0].confidence).toBe("possible");
    expect(nameCols[0].entities_involved.sort()).toEqual([
      "plugin-a:skill:deploy",
      "plugin-b:skill:deploy",
    ]);
    // Disambiguation message present.
    expect(nameCols[0].message).toContain("plugin-a:deploy");
    expect(nameCols[0].message).toContain("plugin-b:deploy");
    // No destructive fix suggestions.
    expect(
      nameCols[0].suggested_fix.some((f) => f.safety_level === "destructive"),
    ).toBe(false);
    // No # comment pseudo-commands.
    expect(
      nameCols[0].suggested_fix.some((f) => f.command.includes("#")),
    ).toBe(false);
  });

  it("produces a possible collision when trigger keywords overlap across distinct skills", async () => {
    const data = await snap([
      {
        name: "plugin-a",
        skills: [{ name: "ship", triggers: ["release"] }],
      },
      {
        name: "plugin-b",
        skills: [{ name: "cut", triggers: ["release"] }],
      },
    ]);
    const collisions = await new SkillNameDetector().analyze(data);
    const possible = collisions.filter((c) => c.confidence === "possible");
    expect(possible).toHaveLength(1);
    expect(possible[0].entities_involved).toEqual(
      expect.arrayContaining([
        "plugin-a:skill:ship:trigger:release",
        "plugin-b:skill:cut:trigger:release",
      ]),
    );
    // Trigger overlap: no # comment fix suggestions.
    expect(
      possible[0].suggested_fix.some((f) => f.command.includes("#")),
    ).toBe(false);
  });

  it("produces no collision when skill names and triggers are all unique", async () => {
    const data = await snap([
      {
        name: "plugin-a",
        skills: [{ name: "alpha", triggers: ["one"] }],
      },
      {
        name: "plugin-b",
        skills: [{ name: "beta", triggers: ["two"] }],
      },
    ]);
    const collisions = await new SkillNameDetector().analyze(data);
    expect(collisions).toEqual([]);
  });

  it("does not flag a trigger that appears only once", async () => {
    const data = await snap([
      { name: "plugin-a", skills: [{ name: "alpha", triggers: ["only"] }] },
    ]);
    const collisions = await new SkillNameDetector().analyze(data);
    expect(collisions).toEqual([]);
  });
});
