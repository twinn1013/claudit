import { describe, expect, it } from "vitest";
import { SkillNameDetector } from "../../src/detectors/skill-name.js";
import { Snapshot } from "../../src/snapshot.js";
import { makeGlobalRoot } from "../helpers/fixtures.js";

async function snap(plugins: Parameters<typeof makeGlobalRoot>[0]) {
  const root = await makeGlobalRoot(plugins);
  return await new Snapshot({ globalRoot: root, pathOverride: "" }).capture();
}

describe("SkillNameDetector", () => {
  it("produces a definite collision when two plugins both define the same skill name", async () => {
    const data = await snap([
      { name: "plugin-a", skills: [{ name: "deploy" }] },
      { name: "plugin-b", skills: [{ name: "deploy" }] },
    ]);
    const collisions = await new SkillNameDetector().analyze(data);
    const definite = collisions.filter((c) => c.confidence === "definite");
    expect(definite).toHaveLength(1);
    expect(definite[0].entities_involved.sort()).toEqual([
      "plugin-a:skill:deploy",
      "plugin-b:skill:deploy",
    ]);
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
