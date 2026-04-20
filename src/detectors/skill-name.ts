import type { Detector } from "../detector.js";
import { pluginOrigin } from "../plugin-identity.js";
import {
  NAMESPACE_AMBIGUITY_CONFIDENCE,
  NAMESPACE_AMBIGUITY_SEVERITY,
  NAMESPACE_TRIGGER_OVERLAP_CONFIDENCE,
  NAMESPACE_TRIGGER_OVERLAP_SEVERITY,
} from "../policies.js";
import type { Collision, SnapshotData } from "../types.js";
import { formatDisambiguationMessage } from "./namespace-util.js";

/**
 * Detects duplicate skill names across plugins and overlapping trigger
 * keywords (possible — activation precedence is runtime-dependent).
 *
 * v0.2: same base name across plugins = info/possible per namespace-aware
 * semantics. CC disambiguates via `plugin:name`, so nothing is broken —
 * but unqualified skill name invocations are ambiguous.
 */
export class SkillNameDetector implements Detector {
  readonly category = "skill-name" as const;

  async analyze(current: SnapshotData): Promise<Collision[]> {
    const collisions: Collision[] = [];

    const nameIndex = new Map<string, Array<{ plugin: string; publicName: string; enabled: boolean }>>();
    const keywordIndex = new Map<string, Array<{ plugin: string; publicName: string; skill: string }>>();
    for (const plugin of current.plugins) {
      for (const skill of plugin.skills) {
        const entries = nameIndex.get(skill.name) ?? [];
        entries.push({
          plugin: pluginOrigin(plugin),
          publicName: plugin.name,
          enabled: plugin.enabled,
        });
        nameIndex.set(skill.name, entries);
        for (const kw of skill.triggerKeywords) {
          const normalized = kw.toLowerCase().trim();
          if (!normalized) continue;
          const holders = keywordIndex.get(normalized) ?? [];
          holders.push({
            plugin: pluginOrigin(plugin),
            publicName: plugin.name,
            skill: skill.name,
          });
          keywordIndex.set(normalized, holders);
        }
      }
    }

    // Skill name collisions: info/possible with disambiguation guidance.
    for (const [name, entries] of nameIndex) {
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
        category: "skill-name",
        severity: NAMESPACE_AMBIGUITY_SEVERITY,
        confidence: NAMESPACE_AMBIGUITY_CONFIDENCE,
        entities_involved: plugins.map((p) => `${p.name}:skill:${name}`),
        suggested_fix: [],
        message: formatDisambiguationMessage("skill", name, plugins),
      });
    }

    // Trigger keyword overlap: keep info/possible, no # comment fix suggestions.
    for (const [keyword, holders] of keywordIndex) {
      const uniquePairs = new Map<string, { plugin: string; publicName: string; skill: string }>();
      for (const h of holders) uniquePairs.set(`${h.plugin}::${h.skill}`, h);
      const entries = [...uniquePairs.values()];
      const distinctSkills = new Set(entries.map((e) => `${e.plugin}:${e.skill}`));
      if (distinctSkills.size < 2) continue;
      collisions.push({
        category: "skill-name",
        severity: NAMESPACE_TRIGGER_OVERLAP_SEVERITY,
        confidence: NAMESPACE_TRIGGER_OVERLAP_CONFIDENCE,
        entities_involved: entries.map(
          (e) => `${e.plugin}:skill:${e.skill}:trigger:${keyword}`,
        ),
        suggested_fix: [],
        message: `Trigger keyword "${keyword}" is shared by ${distinctSkills.size} skills: ${[...distinctSkills].join(", ")}. Activation precedence is runtime-dependent and may surprise users.`,
      });
    }

    return collisions;
  }
}
