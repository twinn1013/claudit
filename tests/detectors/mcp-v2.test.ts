import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { McpIdentifierDetector } from "../../src/detectors/mcp-identifier.js";
import { Snapshot } from "../../src/snapshot.js";
import type { SnapshotData } from "../../src/types.js";

async function mkTmp(prefix: string): Promise<string> {
  return fs.mkdtemp(join(tmpdir(), prefix));
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await fs.mkdir(join(path, ".."), { recursive: true });
  await fs.writeFile(path, JSON.stringify(value), "utf8");
}

async function writePlugin(
  pluginsDir: string,
  name: string,
  mcpServers: Record<string, { tools: string[] }>,
): Promise<void> {
  const pluginDir = join(pluginsDir, name);
  await fs.mkdir(join(pluginDir, ".claude-plugin"), { recursive: true });
  await writeJson(join(pluginDir, ".claude-plugin", "plugin.json"), {
    name,
    mcpServers,
  });
}

/** Build an isolated snapshot with user-level + project-level MCP servers. */
async function makeSnap(opts: {
  userMcpServers?: Record<string, { tools: string[] }>;
  projectMcpJson?: Record<string, { tools: string[] }>;
  plugins?: Array<{ name: string; mcpServers: Record<string, { tools: string[] }> }>;
}): Promise<SnapshotData> {
  const root = await mkTmp("claudit-mcp-v2-");
  const globalRoot = join(root, "global");
  const projectRoot = join(root, "project");
  await fs.mkdir(join(globalRoot, "plugins"), { recursive: true });
  await fs.mkdir(projectRoot, { recursive: true });

  if (opts.userMcpServers) {
    await writeJson(join(globalRoot, "settings.json"), {
      mcpServers: opts.userMcpServers,
    });
  }
  if (opts.projectMcpJson) {
    await writeJson(join(projectRoot, ".mcp.json"), {
      mcpServers: opts.projectMcpJson,
    });
  }
  if (opts.plugins?.length) {
    for (const p of opts.plugins) {
      await writePlugin(join(globalRoot, "plugins"), p.name, p.mcpServers);
    }
  }

  return new Snapshot({
    globalRoot,
    projectRoot,
    pathOverride: "",
    homeMcpConfigPath: "/nonexistent/claudit-mcp-v2-home.json",
    managedSettingsPath: null,
  }).capture();
}

describe("MCP detector v2 — extended input sources", () => {
  // Exit criterion 1: user-level + plugin-level same name → definite collision
  it("user-level settings.json server + plugin server with same name → definite collision", async () => {
    const data = await makeSnap({
      userMcpServers: { search: { tools: ["web"] } },
      plugins: [{ name: "plugin-a", mcpServers: { search: { tools: ["index"] } } }],
    });
    const collisions = await new McpIdentifierDetector().analyze(data);
    const definite = collisions.filter((c) => c.confidence === "definite");
    expect(definite).toHaveLength(1);
    expect(definite[0].severity).toBe("critical");
    const entities = definite[0].entities_involved.sort();
    expect(entities).toContain("plugin-a:mcp:search");
    expect(entities).toContain("user-settings:mcp:search");
  });

  // Exit criterion 2: plugin with string-path mcpServers resolves and reads the file
  it("plugin with mcpServers string path resolves to file and captures servers", async () => {
    const root = await mkTmp("claudit-mcp-strpath-");
    const globalRoot = join(root, "global");
    const pluginDir = join(globalRoot, "plugins", "plugin-str");
    await fs.mkdir(join(pluginDir, ".claude-plugin"), { recursive: true });
    // Write the referenced .mcp.json file
    await writeJson(join(pluginDir, ".mcp.json"), {
      mcpServers: { github: { tools: ["issues", "prs"] } },
    });
    // Write plugin.json with a string path
    await writeJson(join(pluginDir, ".claude-plugin", "plugin.json"), {
      name: "plugin-str",
      mcpServers: "./.mcp.json",
    });

    const snap = new Snapshot({
      globalRoot,
      pathOverride: "",
      homeMcpConfigPath: "/nonexistent/claudit-mcp-strpath-home.json",
      managedSettingsPath: null,
    });
    const data = await snap.capture();
    const plugin = data.plugins.find((p) => p.name === "plugin-str");
    expect(plugin).toBeDefined();
    expect(plugin!.mcpServers.map((m) => m.name)).toContain("github");
    expect(plugin!.mcpServers.find((m) => m.name === "github")?.tools).toEqual([
      "issues",
      "prs",
    ]);
  });

  // New: project-level .mcp.json + user-level → definite collision
  it("project-level .mcp.json server + user-level server with same name → definite collision", async () => {
    const data = await makeSnap({
      userMcpServers: { search: { tools: ["web"] } },
      projectMcpJson: { search: { tools: ["local"] } },
    });
    expect(data.projectMcpServers.map((m) => m.name)).toContain("search");
    const collisions = await new McpIdentifierDetector().analyze(data);
    const definite = collisions.filter((c) => c.confidence === "definite");
    expect(definite).toHaveLength(1);
    expect(definite[0].severity).toBe("critical");
    const entities = definite[0].entities_involved.sort();
    expect(entities).toContain("project-settings:mcp:search");
    expect(entities).toContain("user-settings:mcp:search");
  });

  // New: project-level .mcp.json + plugin → definite collision
  it("project-level .mcp.json server + plugin server with same name → definite collision", async () => {
    const data = await makeSnap({
      projectMcpJson: { foo: { tools: ["run"] } },
      plugins: [{ name: "plugin-bar", mcpServers: { foo: { tools: ["exec"] } } }],
    });
    const collisions = await new McpIdentifierDetector().analyze(data);
    const definite = collisions.filter((c) => c.confidence === "definite");
    expect(definite).toHaveLength(1);
    const entities = definite[0].entities_involved.sort();
    expect(entities).toContain("plugin-bar:mcp:foo");
    expect(entities).toContain("project-settings:mcp:foo");
  });

  it("same plugin name across marketplaces stays distinct for MCP origins", async () => {
    const root = await mkTmp("claudit-mcp-identity-");
    const globalRoot = join(root, "global");
    const alphaDir = join(globalRoot, "plugins", "cache", "alpha", "foo", "1.0.0");
    const betaDir = join(globalRoot, "plugins", "cache", "beta", "foo", "1.0.0");

    await writeJson(join(alphaDir, ".claude-plugin", "plugin.json"), {
      name: "foo",
      version: "1.0.0",
      mcpServers: { search: { tools: ["web"] } },
    });
    await writeJson(join(betaDir, ".claude-plugin", "plugin.json"), {
      name: "foo",
      version: "1.0.0",
      mcpServers: { search: { tools: ["index"] } },
    });

    const data = await new Snapshot({
      globalRoot,
      pathOverride: "",
      homeMcpConfigPath: "/nonexistent/claudit-mcp-identity-home.json",
      managedSettingsPath: null,
    }).capture();
    const collisions = await new McpIdentifierDetector().analyze(data);
    const definite = collisions.filter((c) => c.confidence === "definite");

    expect(definite).toHaveLength(1);
    expect(definite[0].entities_involved).toContain("foo@alpha:mcp:search");
    expect(definite[0].entities_involved).toContain("foo@beta:mcp:search");
  });

  // New: tool-name collision across project + plugin origins → possible/warning
  it("tool-name collision between project-level and plugin servers → possible collision", async () => {
    const data = await makeSnap({
      projectMcpJson: { "server-a": { tools: ["search"] } },
      plugins: [{ name: "plugin-b", mcpServers: { "server-b": { tools: ["search"] } } }],
    });
    const collisions = await new McpIdentifierDetector().analyze(data);
    const possible = collisions.filter((c) => c.confidence === "possible");
    expect(possible).toHaveLength(1);
    expect(possible[0].severity).toBe("warning");
    expect(possible[0].message).toContain("search");
  });

  // Negative: no FixSuggestion.command contains '#'
  it("no FixSuggestion.command contains a # character", async () => {
    const data = await makeSnap({
      userMcpServers: { clash: { tools: ["a"] } },
      plugins: [{ name: "plugin-x", mcpServers: { clash: { tools: ["b"] } } }],
    });
    const collisions = await new McpIdentifierDetector().analyze(data);
    for (const c of collisions) {
      for (const fix of c.suggested_fix) {
        expect(fix.command).not.toContain("#");
      }
    }
  });

  // Negative: no FixSuggestion has safety_level "destructive"
  it("no FixSuggestion has safety_level destructive", async () => {
    const data = await makeSnap({
      userMcpServers: { clash: { tools: ["x"] } },
      plugins: [{ name: "plugin-y", mcpServers: { clash: { tools: ["y"] } } }],
    });
    const collisions = await new McpIdentifierDetector().analyze(data);
    for (const c of collisions) {
      for (const fix of c.suggested_fix) {
        expect(fix.safety_level).not.toBe("destructive");
      }
    }
  });

  // No collision when all servers are unique across all sources
  it("no collision when all server names are unique across all sources", async () => {
    const data = await makeSnap({
      userMcpServers: { "user-svc": { tools: ["fetch"] } },
      projectMcpJson: { "project-svc": { tools: ["build"] } },
      plugins: [{ name: "plugin-z", mcpServers: { "plugin-svc": { tools: ["run"] } } }],
    });
    const collisions = await new McpIdentifierDetector().analyze(data);
    expect(collisions).toHaveLength(0);
  });
});
