// v0.2: same base name across plugins = info/possible per namespace-aware semantics; was definite/warning in v0.1.
import { describe, expect, it } from "vitest";
import { SubagentTypeDetector } from "../../src/detectors/subagent-type.js";
import { Snapshot } from "../../src/snapshot.js";
import { makeGlobalRoot } from "../helpers/fixtures.js";

async function snap(plugins: Parameters<typeof makeGlobalRoot>[0]) {
  const root = await makeGlobalRoot(plugins);
  return await new Snapshot({ globalRoot: root, pathOverride: "" }).capture();
}

describe("SubagentTypeDetector", () => {
  it("produces an info/possible collision when two plugins define agent 'researcher'", async () => {
    const data = await snap([
      { name: "plugin-a", agents: ["researcher"] },
      { name: "plugin-b", agents: ["researcher"] },
    ]);
    const collisions = await new SubagentTypeDetector().analyze(data);
    expect(collisions).toHaveLength(1);
    expect(collisions[0].severity).toBe("info");
    expect(collisions[0].confidence).toBe("possible");
    expect(collisions[0].category).toBe("subagent-type");
    expect(collisions[0].entities_involved.sort()).toEqual([
      "plugin-a:agent:researcher",
      "plugin-b:agent:researcher",
    ]);
    // Disambiguation message.
    expect(collisions[0].message).toContain("plugin-a:researcher");
    expect(collisions[0].message).toContain("plugin-b:researcher");
    // No destructive fix suggestions.
    expect(
      collisions[0].suggested_fix.some((f) => f.safety_level === "destructive"),
    ).toBe(false);
    // No # comment pseudo-commands.
    expect(
      collisions[0].suggested_fix.some((f) => f.command.includes("#")),
    ).toBe(false);
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
