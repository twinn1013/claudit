import type { Detector } from "../detector.js";
import type { Collision, SnapshotData } from "../types.js";

/**
 * Detects duplicate subagent `type` names across plugins. A duplicate type
 * is a definite collision — when the Agent tool is invoked with a given
 * `subagent_type`, CC must pick one of the implementations.
 */
export class SubagentTypeDetector implements Detector {
  readonly category = "subagent-type" as const;

  async analyze(current: SnapshotData): Promise<Collision[]> {
    const byType = new Map<string, string[]>();
    for (const plugin of current.plugins) {
      for (const agent of plugin.agents) {
        const holders = byType.get(agent.type) ?? [];
        holders.push(plugin.name);
        byType.set(agent.type, holders);
      }
    }

    const collisions: Collision[] = [];
    for (const [type, plugins] of byType) {
      const unique = [...new Set(plugins)].sort();
      if (unique.length < 2) continue;
      collisions.push({
        category: "subagent-type",
        severity: "warning",
        confidence: "definite",
        entities_involved: unique.map((p) => `${p}:agent:${type}`),
        suggested_fix: [
          {
            command: `# rename subagent type in one of: ${unique.join(", ")}`,
            scope: "plugin",
            safety_level: "manual-review",
            rationale: `Two or more plugins define a subagent with type "${type}"; Agent(subagent_type="${type}") is ambiguous.`,
          },
        ],
        message: `${unique.length} plugins define subagent type "${type}": ${unique.join(", ")}.`,
      });
    }
    return collisions;
  }
}
