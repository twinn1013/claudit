import type { HookSource, PluginSummary } from "./types.js";

export interface PluginIdentityFields {
  name: string;
  marketplace?: string;
  qualifiedName?: string;
}

export function buildQualifiedPluginName(
  name: string,
  marketplace?: string,
): string {
  return marketplace ? `${name}@${marketplace}` : name;
}

export function pluginQualifiedName(plugin: PluginIdentityFields): string {
  return plugin.qualifiedName ?? buildQualifiedPluginName(plugin.name, plugin.marketplace);
}

export function derivePluginMarketplace(
  pluginRoot: string,
  source: HookSource,
): string | undefined {
  const parts = pluginRoot.split(/[\\/]+/).filter(Boolean);

  if (source === "plugin-cache") {
    const index = parts.lastIndexOf("cache");
    if (index >= 0 && parts[index + 1]) return parts[index + 1];
  }

  if (source === "plugin-marketplace") {
    const index = parts.lastIndexOf("marketplaces");
    if (index >= 0 && parts[index + 1]) return parts[index + 1];
  }

  return undefined;
}

export function resolvePluginEnabledState(
  plugin: PluginIdentityFields,
  enabledMap: Record<string, boolean>,
): boolean | null {
  const qualified = pluginQualifiedName(plugin);
  if (Object.prototype.hasOwnProperty.call(enabledMap, qualified)) {
    return enabledMap[qualified];
  }
  if (Object.prototype.hasOwnProperty.call(enabledMap, plugin.name)) {
    return enabledMap[plugin.name];
  }
  return null;
}

export function pluginOrigin(plugin: PluginSummary): string {
  return pluginQualifiedName(plugin);
}
