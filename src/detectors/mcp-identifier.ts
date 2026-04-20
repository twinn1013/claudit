import type { Detector } from "../detector.js";
import { pluginOrigin } from "../plugin-identity.js";
import type { Collision, McpServer, SnapshotData } from "../types.js";

interface ServerOrigin {
  name: string;
  origin: string;   // plugin name, "user-settings", or "project-settings"
  tools: string[];
}

/**
 * Detects MCP identifier collisions:
 *  - Two servers sharing the same `name` across plugins/settings (definite).
 *  - Two distinct servers exposing the same tool name (possible — CC may
 *    namespace tools by server name, but that is runtime-dependent).
 */
export class McpIdentifierDetector implements Detector {
  readonly category = "mcp-identifier" as const;

  async analyze(current: SnapshotData): Promise<Collision[]> {
    const all = collectMcpServers(current);
    const collisions: Collision[] = [];

    const byName = new Map<string, ServerOrigin[]>();
    for (const server of all) {
      const entries = byName.get(server.name) ?? [];
      entries.push(server);
      byName.set(server.name, entries);
    }
    for (const [name, entries] of byName) {
      const uniqueOrigins = [...new Set(entries.map((e) => e.origin))].sort();
      if (uniqueOrigins.length < 2) continue;
      collisions.push({
        category: "mcp-identifier",
        severity: "critical",
        confidence: "definite",
        entities_involved: uniqueOrigins.map((o) => `${o}:mcp:${name}`),
        suggested_fix: [
          {
            command: "",
            scope: "global",
            safety_level: "manual-review",
            rationale: `Server name "${name}" is registered by ${uniqueOrigins.length} sources (${uniqueOrigins.join(", ")}). Remove or rename one registration so only one source defines this server.`,
          },
        ],
        message: `MCP server name "${name}" is registered by ${uniqueOrigins.length} sources: ${uniqueOrigins.join(", ")}.`,
      });
    }

    const byTool = new Map<string, ServerOrigin[]>();
    for (const server of all) {
      for (const tool of server.tools) {
        if (!tool) continue;
        const holders = byTool.get(tool) ?? [];
        holders.push(server);
        byTool.set(tool, holders);
      }
    }
    for (const [tool, holders] of byTool) {
      const distinctServers = new Map<string, ServerOrigin>();
      for (const h of holders) distinctServers.set(`${h.origin}::${h.name}`, h);
      if (distinctServers.size < 2) continue;
      const entities = [...distinctServers.values()].map(
        (s) => `${s.origin}:mcp:${s.name}:tool:${tool}`,
      );
      collisions.push({
        category: "mcp-identifier",
        severity: "warning",
        confidence: "possible",
        entities_involved: entities.sort(),
        suggested_fix: [
          {
            command: "",
            scope: "plugin",
            safety_level: "manual-review",
            rationale: `Tool name "${tool}" is exposed by ${distinctServers.size} different servers. If the MCP runtime does not namespace by server name, invocations become ambiguous. Rename the tool in one of the servers listed above.`,
          },
        ],
        message: `Tool "${tool}" is exposed by ${distinctServers.size} distinct MCP servers.`,
      });
    }

    return collisions;
  }
}

function collectMcpServers(snapshot: SnapshotData): ServerOrigin[] {
  const out: ServerOrigin[] = [];
  // Plugin-declared servers.
  for (const plugin of snapshot.plugins) {
    for (const m of plugin.mcpServers) {
      out.push({ name: m.name, origin: pluginOrigin(plugin), tools: m.tools });
    }
  }
  // User-level settings servers (~/.claude/settings.json, ~/.claude.json, managed).
  for (const m of snapshot.settingsMcpServers) {
    out.push({ name: m.name, origin: "user-settings", tools: m.tools });
  }
  // Project-level servers (<projectRoot>/.mcp.json, .claude/settings*.json).
  for (const m of snapshot.projectMcpServers) {
    out.push({ name: m.name, origin: "project-settings", tools: m.tools });
  }
  return out;
}

// re-export for consumer typing convenience
export type { McpServer };
