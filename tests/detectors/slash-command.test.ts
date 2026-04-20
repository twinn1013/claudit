import { describe, expect, it } from "vitest";
import { SlashCommandDetector } from "../../src/detectors/slash-command.js";
import { Snapshot } from "../../src/snapshot.js";
import { makeGlobalRoot } from "../helpers/fixtures.js";

async function snap(plugins: Parameters<typeof makeGlobalRoot>[0]) {
  const root = await makeGlobalRoot(plugins);
  return await new Snapshot({ globalRoot: root, pathOverride: "" }).capture();
}

describe("SlashCommandDetector", () => {
  it("produces a definite collision when two plugins both register /scan", async () => {
    const data = await snap([
      { name: "plugin-a", commands: ["scan.md"] },
      { name: "plugin-b", commands: ["scan.md"] },
    ]);
    const collisions = await new SlashCommandDetector().analyze(data);
    expect(collisions).toHaveLength(1);
    expect(collisions[0].confidence).toBe("definite");
    expect(collisions[0].category).toBe("slash-command");
    expect(collisions[0].entities_involved.sort()).toEqual([
      "plugin-a:/scan",
      "plugin-b:/scan",
    ]);
  });

  it("produces no collision when command names are distinct", async () => {
    const data = await snap([
      { name: "plugin-a", commands: ["scan.md"] },
      { name: "plugin-b", commands: ["status.md"] },
    ]);
    const collisions = await new SlashCommandDetector().analyze(data);
    expect(collisions).toEqual([]);
  });

  it("produces exactly one collision for 3 plugins with 2 overlapping", async () => {
    const data = await snap([
      { name: "plugin-a", commands: ["scan.md", "lint.md"] },
      { name: "plugin-b", commands: ["scan.md"] },
      { name: "plugin-c", commands: ["status.md"] },
    ]);
    const collisions = await new SlashCommandDetector().analyze(data);
    expect(collisions).toHaveLength(1);
    expect(collisions[0].entities_involved).toEqual(
      expect.arrayContaining(["plugin-a:/scan", "plugin-b:/scan"]),
    );
  });

  it("does not treat a single plugin defining two commands as a collision", async () => {
    const data = await snap([
      { name: "plugin-a", commands: ["scan.md", "status.md"] },
    ]);
    const collisions = await new SlashCommandDetector().analyze(data);
    expect(collisions).toEqual([]);
  });
});
