import { describe, expect, it } from "vitest";
import { McpIdentifierDetector } from "../../src/detectors/mcp-identifier.js";
import { Snapshot } from "../../src/snapshot.js";
import { makeGlobalRoot } from "../helpers/fixtures.js";

async function snap(
  plugins: Parameters<typeof makeGlobalRoot>[0],
  extras?: Parameters<typeof makeGlobalRoot>[1],
) {
  const root = await makeGlobalRoot(plugins, extras);
  return await new Snapshot({ globalRoot: root, pathOverride: "" }).capture();
}

describe("McpIdentifierDetector", () => {
  it("produces a definite collision when two plugins register the same server name", async () => {
    const data = await snap([
      {
        name: "plugin-a",
        mcpServers: { github: { tools: ["issues"] } },
      },
      {
        name: "plugin-b",
        mcpServers: { github: { tools: ["prs"] } },
      },
    ]);
    const collisions = await new McpIdentifierDetector().analyze(data);
    const definite = collisions.filter((c) => c.confidence === "definite");
    expect(definite).toHaveLength(1);
    expect(definite[0].entities_involved.sort()).toEqual([
      "plugin-a:mcp:github",
      "plugin-b:mcp:github",
    ]);
  });

  it("treats a plugin + settings.json with the same server name as a definite collision", async () => {
    const data = await snap(
      [
        {
          name: "plugin-a",
          mcpServers: { github: { tools: ["issues"] } },
        },
      ],
      { settingsMcpServers: { github: { tools: [] } } },
    );
    const collisions = await new McpIdentifierDetector().analyze(data);
    const definite = collisions.filter((c) => c.confidence === "definite");
    expect(definite).toHaveLength(1);
    expect(definite[0].entities_involved.sort()).toEqual([
      "plugin-a:mcp:github",
      "settings.json:mcp:github",
    ]);
  });

  it("produces a possible collision when two distinct servers expose the same tool", async () => {
    const data = await snap([
      {
        name: "plugin-a",
        mcpServers: { github: { tools: ["search"] } },
      },
      {
        name: "plugin-b",
        mcpServers: { linear: { tools: ["search"] } },
      },
    ]);
    const collisions = await new McpIdentifierDetector().analyze(data);
    const possible = collisions.filter((c) => c.confidence === "possible");
    expect(possible).toHaveLength(1);
    expect(possible[0].message).toContain("search");
  });

  it("produces no collision when server names and tool names are all unique", async () => {
    const data = await snap([
      {
        name: "plugin-a",
        mcpServers: { github: { tools: ["issues"] } },
      },
      {
        name: "plugin-b",
        mcpServers: { linear: { tools: ["query"] } },
      },
    ]);
    const collisions = await new McpIdentifierDetector().analyze(data);
    expect(collisions).toEqual([]);
  });
});
