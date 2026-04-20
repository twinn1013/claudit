import { describe, expect, it } from "vitest";
import { SubagentTypeDetector } from "../../src/detectors/subagent-type.js";
import { Snapshot } from "../../src/snapshot.js";
import { makeGlobalRoot } from "../helpers/fixtures.js";

async function snap(plugins: Parameters<typeof makeGlobalRoot>[0]) {
  const root = await makeGlobalRoot(plugins);
  return await new Snapshot({ globalRoot: root, pathOverride: "" }).capture();
}

describe("SubagentTypeDetector", () => {
  it("produces a definite collision when two plugins define agent type 'researcher'", async () => {
    const data = await snap([
      { name: "plugin-a", agents: ["researcher"] },
      { name: "plugin-b", agents: ["researcher"] },
    ]);
    const collisions = await new SubagentTypeDetector().analyze(data);
    expect(collisions).toHaveLength(1);
    expect(collisions[0].confidence).toBe("definite");
    expect(collisions[0].category).toBe("subagent-type");
    expect(collisions[0].entities_involved.sort()).toEqual([
      "plugin-a:agent:researcher",
      "plugin-b:agent:researcher",
    ]);
  });

  it("produces no collision when subagent types are unique", async () => {
    const data = await snap([
      { name: "plugin-a", agents: ["researcher", "planner"] },
      { name: "plugin-b", agents: ["critic"] },
    ]);
    const collisions = await new SubagentTypeDetector().analyze(data);
    expect(collisions).toEqual([]);
  });

  it("does not flag a single plugin defining multiple agents", async () => {
    const data = await snap([
      { name: "plugin-a", agents: ["a", "b", "c"] },
    ]);
    const collisions = await new SubagentTypeDetector().analyze(data);
    expect(collisions).toEqual([]);
  });
});
