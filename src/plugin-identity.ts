import type { HookSource, PluginSummary } from "./types.js";

export interface PluginIdentityFields {
  name: string;
  marketplace?: string;
  qualifiedName?: string;
}

/** Build the canonical plugin identity key used for enabledPlugins lookups. */
export function buildQualifiedPluginName(
  name: string,
  marketplace?: string,
): string {
  return marketplace ? `${name}@${marketplace}` : name;
}

/** Return the precomputed qualified name when present, else derive it on demand. */
export function pluginQualifiedName(plugin: PluginIdentityFields): string {
  return plugin.qualifiedName ?? buildQualifiedPluginName(plugin.name, plugin.marketplace);
}

/**
 * Derive marketplace identity from the observed Claude Code install layouts.
 *
 * Cache installs look like `plugins/cache/<marketplace>/<plugin>/<version>/`.
 * Marketplace-root installs look like `plugins/marketplaces/<marketplace>/`.
 */
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

/**
 * Resolve enablement using the marketplace-qualified key first, falling back
 * to the legacy bare plugin name only when no qualified key exists.
 */
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

/** String form used by detectors and reports when they need a unique plugin origin. */
export function pluginOrigin(plugin: PluginSummary): string {
  return pluginQualifiedName(plugin);
}
