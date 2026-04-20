/**
 * Shared helpers for namespace-aware disambiguation messages used by
 * slash-command, skill-name, and subagent-type detectors.
 *
 * v0.2: same base name across plugins = info/possible. CC handles namespacing
 * via `plugin:name` prefix, so the collision is an ambiguity warning only.
 */

export interface PluginRef {
  name: string;
  enabled: boolean;
}

/**
 * Returns true if any plugin in the list is disabled.
 */
export function hasDisabledPlugin(plugins: PluginRef[]): boolean {
  return plugins.some((p) => !p.enabled);
}

/**
 * Format a disambiguation message for a namespace ambiguity.
 *
 * @param kind   - "command" | "skill" | "agent"
 * @param name   - the base identifier name (e.g., "scan")
 * @param plugins - list of plugins defining this identifier (sorted)
 */
export function formatDisambiguationMessage(
  kind: "command" | "skill" | "agent",
  name: string,
  plugins: PluginRef[],
): string {
  const pluginNames = plugins.map((p) => p.name);
  const disabledNames = plugins.filter((p) => !p.enabled).map((p) => p.name);

  let invocationExamples: string;
  if (kind === "command") {
    invocationExamples = pluginNames
      .slice(0, 2)
      .map((p) => `/${p}:${name}`)
      .join(" or ");
  } else if (kind === "skill") {
    invocationExamples = pluginNames
      .slice(0, 2)
      .map((p) => `${p}:${name}`)
      .join(" or ");
  } else {
    // agent
    invocationExamples = pluginNames
      .slice(0, 2)
      .map((p) => `${p}:${name}`)
      .join(" or ");
  }

  const listStr = pluginNames.join(", ");

  let msg: string;
  if (kind === "command") {
    msg = `Multiple plugins define /${name}: ${listStr}. Use ${invocationExamples} to disambiguate.`;
  } else if (kind === "skill") {
    msg = `Multiple plugins define skill "${name}": ${listStr}. Use ${invocationExamples} to disambiguate.`;
  } else {
    msg = `Multiple plugins define subagent "${name}": ${listStr}. Use ${invocationExamples} when invoking the Agent tool.`;
  }

  if (disabledNames.length > 0) {
    const disabledList = disabledNames.map((n) => `"${n}"`).join(", ");
    msg += ` ${disabledList} ${disabledNames.length === 1 ? "is" : "are"} currently disabled; this collision would activate on re-enable.`;
  }

  return msg;
}
