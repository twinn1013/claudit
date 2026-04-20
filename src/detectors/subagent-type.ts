import type { Detector } from "../detector.js";
import { pluginOrigin } from "../plugin-identity.js";
import {
  NAMESPACE_AMBIGUITY_CONFIDENCE,
  NAMESPACE_AMBIGUITY_SEVERITY,
} from "../policies.js";
import type { Collision, SnapshotData } from "../types.js";
import { formatDisambiguationMessage } from "./namespace-util.js";

/**
 * Detects duplicate subagent names across plugins.
 *
 * v0.2: same agent name across plugins = info/possible per namespace-aware
 * semantics. CC exposes agents as `plugin:name`, so unqualified invocations
 * are ambiguous but not broken.
 */
export class SubagentTypeDetector implements Detector {
  readonly category = "subagent-type" as const;

  async analyze(current: SnapshotData): Promise<Collision[]> {
    const byName = new Map<string, Array<{ plugin: string; publicName: string; enabled: boolean }>>();
    for (const plugin of current.plugins) {
      for (const agent of plugin.agents) {
        const entries = byName.get(agent.name) ?? [];
        entries.push({
          plugin: pluginOrigin(plugin),
          publicName: plugin.name,
          enabled: plugin.enabled,
        });
        byName.set(agent.name, entries);
      }
    }

    const collisions: Collision[] = [];
    for (const [name, entries] of byName) {
      // Dedupe by plugin name, keeping enabled=false if any entry for that plugin is disabled.
      const pluginMap = new Map<string, { enabled: boolean; publicName: string }>();
      for (const e of entries) {
        const currentEntry = pluginMap.get(e.plugin);
        pluginMap.set(e.plugin, {
          enabled: (currentEntry?.enabled ?? true) && e.enabled,
          publicName: currentEntry?.publicName ?? e.publicName,
        });
      }
      if (pluginMap.size < 2) continue;

      const plugins = [...pluginMap.entries()]
        .map(([n, info]) => ({
          name: n,
          publicName: info.publicName,
          enabled: info.enabled,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));

      collisions.push({
        category: "subagent-type",
        severity: NAMESPACE_AMBIGUITY_SEVERITY,
        confidence: NAMESPACE_AMBIGUITY_CONFIDENCE,
        entities_involved: plugins.map((p) => `${p.name}:agent:${name}`),
        suggested_fix: [],
        message: formatDisambiguationMessage("agent", name, plugins),
      });
    }
    return collisions;
  }
}
