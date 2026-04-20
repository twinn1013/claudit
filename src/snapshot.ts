import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { delimiter, join, resolve, sep } from "node:path";
import { homedir } from "node:os";
import {
  extractFrontmatter,
  parseYamlSubset,
  type ParsedFrontmatter,
} from "./yaml-frontmatter.js";
import type {
  HookRegistration,
  HookScript,
  HookSource,
  McpServer,
  PluginAgent,
  PluginCommand,
  PluginSkill,
  PluginSummary,
  SettingsHookEntry,
  SnapshotData,
} from "./types.js";

/** Default global root — `~/.claude/`. */
export const defaultGlobalRoot = (): string => join(homedir(), ".claude");

/** Default snapshot storage directory — `~/.claude/claudit/snapshots/`. */
export const defaultSnapshotStorage = (): string =>
  join(homedir(), ".claude", "claudit", "snapshots");

/** Default home-level MCP config path — `~/.claude.json` (Delta 1). */
export const defaultHomeMcpConfigPath = (): string =>
  join(homedir(), ".claude.json");

/**
 * Default managed-settings path (Delta 2a). Enterprise-policy location on
 * macOS; Linux falls back to `/etc/claude-code/managed-settings.json`.
 * Windows is not probed (no canonical path documented for CC).
 */
export const defaultManagedSettingsPath = (): string | null => {
  if (process.platform === "darwin") {
    return "/Library/Application Support/ClaudeCode/managed-settings.json";
  }
  if (process.platform === "linux") {
    return "/etc/claude-code/managed-settings.json";
  }
  return null;
};

import {
  HOOK_SCRIPT_MAX_BYTES as HOOK_SCRIPT_MAX_BYTES_CONST,
  SNAPSHOT_FILE_MAX_BYTES,
} from "./policies.js";

/** Cap per-hook-script source read at 4KB for static analysis. */
const HOOK_SCRIPT_MAX_BYTES = HOOK_SCRIPT_MAX_BYTES_CONST;
/** Snapshot files must stay under 1MB. */
export const SNAPSHOT_SIZE_LIMIT = SNAPSHOT_FILE_MAX_BYTES;

export interface SnapshotOptions {
  globalRoot?: string;
  /** Project-level `.claude/` to merge into the scan. When omitted, skipped. */
  projectRoot?: string;
  /** Override for PATH scanning; defaults to `process.env.PATH`. */
  pathOverride?: string;
  /** Storage directory for `save()`; defaults to `~/.claude/claudit/snapshots/`. */
  storageRoot?: string;
  /** Optional file-system fake for tests. */
  fs?: typeof fs;
  /**
   * Override for the home-level MCP config file (Delta 1). Defaults to
   * `~/.claude.json`. Tests use this to point at a temp path without
   * polluting the user home.
   */
  homeMcpConfigPath?: string;
  /**
   * Override for the managed-settings path (Delta 2a). Defaults to the
   * platform-specific location. Pass an explicit path for tests; pass
   * `null` to disable probing entirely.
   */
  managedSettingsPath?: string | null;
}

export interface SnapshotDiff {
  plugins: {
    added: PluginSummary[];
    removed: PluginSummary[];
    modified: Array<{ before: PluginSummary; after: PluginSummary }>;
  };
  settingsMcpServers: {
    added: McpServer[];
    removed: McpServer[];
  };
  pathBinaries: {
    added: Record<string, string[]>;
    removed: Record<string, string[]>;
    modified: Record<string, { before: string[]; after: string[] }>;
  };
  /** True if any category shows a change. */
  hasChanges: boolean;
}

/**
 * Snapshot — captures the claudit-relevant state of a Claude Code install.
 *
 * v0.2 captures 5 hook scopes: plugin-cache, plugin-marketplace,
 * user-settings(+local), project-settings(+local), and user-managed
 * (enterprise policy). Each scope tags its hook registrations with a
 * `source: HookSource` discriminator so downstream detectors can route by
 * provenance.
 */
export class Snapshot {
  private _data: SnapshotData | null = null;
  private readonly fs: typeof fs;
  private readonly storageRoot: string;

  constructor(private readonly options: SnapshotOptions = {}) {
    this.fs = options.fs ?? fs;
    this.storageRoot = options.storageRoot ?? defaultSnapshotStorage();
  }

  get data(): SnapshotData {
    if (!this._data) {
      throw new Error("Snapshot.data accessed before capture()/load()");
    }
    return this._data;
  }

  async capture(): Promise<SnapshotData> {
    const globalRoot = this.options.globalRoot ?? defaultGlobalRoot();
    const projectRoot = this.options.projectRoot;

    // 1. Plugin discovery (cache + marketplace layouts).
    const cachePlugins = await this.capturePluginsFromCache(globalRoot);
    const marketplacePlugins =
      await this.capturePluginsFromMarketplaces(globalRoot);
    // Legacy v0.1 layout: `<root>/plugins/<plugin>/` or `<root>/plugins/<m>/<plugin>/`.
    // We keep this walk for backwards compatibility with the existing test fixtures
    // (and for any install that still uses the flat `plugins/` directory).
    const legacyPlugins = await this.capturePluginsFromLegacy(globalRoot);
    const projectPlugins = projectRoot
      ? await this.capturePluginsFromLegacy(projectRoot)
      : [];

    let plugins = dedupePluginsByRoot([
      ...cachePlugins,
      ...marketplacePlugins,
      ...legacyPlugins,
      ...projectPlugins,
    ]);

    // 2. Settings capture (user + project + managed).
    const userSettings = await this.captureUserSettings(globalRoot);
    const projectSettings = projectRoot
      ? await this.captureProjectSettings(projectRoot)
      : emptySettingsCapture();

    // 3. Apply enabledPlugins filter (user scope wins, project scope overrides).
    plugins = applyEnabledPluginsFilter(plugins, {
      ...userSettings.enabledPlugins,
      ...projectSettings.enabledPlugins,
    });

    // 4. Sort plugins deterministically so fingerprint is stable.
    plugins.sort((a, b) => a.pluginRoot.localeCompare(b.pluginRoot));

    const settingsHooks: SettingsHookEntry[] = [
      ...userSettings.settingsHooks,
      ...projectSettings.settingsHooks,
    ];
    const settingsMcpServers: McpServer[] = dedupeMcpByName([
      ...userSettings.mcpServers,
      ...projectSettings.mcpServers,
    ]);

    const pathBinaries = await this.capturePathBinaries(
      this.options.pathOverride ?? process.env.PATH ?? "",
    );
    const capturedAt = new Date().toISOString();
    const body: Omit<SnapshotData, "fingerprint"> = {
      globalRoot,
      projectRoot,
      plugins,
      settingsMcpServers,
      settingsHooks,
      pathBinaries,
      capturedAt,
    };
    const fingerprint = this.fingerprint(body);
    this._data = { ...body, fingerprint };
    return this._data;
  }

  /** Save a captured snapshot and prune so at most 2 survive. Returns path. */
  async save(): Promise<string> {
    const data = this.data;
    await this.fs.mkdir(this.storageRoot, { recursive: true });
    const file = `snapshot-${data.capturedAt.replace(/[:.]/g, "-")}-${data.fingerprint.slice(0, 8)}.json`;
    const out = join(this.storageRoot, file);
    const json = JSON.stringify(data);
    if (Buffer.byteLength(json, "utf8") > SNAPSHOT_SIZE_LIMIT) {
      throw new Error(
        `Snapshot payload ${Buffer.byteLength(json, "utf8")}B exceeds 1MB cap`,
      );
    }
    await this.fs.writeFile(out, json, "utf8");
    await pruneSnapshotsImpl(this.storageRoot, 2, this.fs);
    return out;
  }

  static async load(path: string, fsImpl: typeof fs = fs): Promise<Snapshot> {
    const raw = await fsImpl.readFile(path, "utf8");
    const parsed = JSON.parse(raw) as SnapshotData;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof (parsed as SnapshotData).fingerprint !== "string" ||
      typeof (parsed as SnapshotData).capturedAt !== "string" ||
      !Array.isArray((parsed as SnapshotData).plugins) ||
      !Array.isArray((parsed as SnapshotData).settingsMcpServers) ||
      !Array.isArray((parsed as SnapshotData).settingsHooks) ||
      typeof (parsed as SnapshotData).pathBinaries !== "object"
    ) {
      throw new Error(`Snapshot.load: ${path} is not a valid snapshot file`);
    }
    const snap = new Snapshot({ fs: fsImpl });
    snap._data = parsed;
    return snap;
  }

  /** Most recently saved snapshot under a storage root, or null if none. */
  static async loadLatest(
    storageRoot: string = defaultSnapshotStorage(),
    fsImpl: typeof fs = fs,
  ): Promise<Snapshot | null> {
    const files = await listSnapshotFiles(storageRoot, fsImpl);
    if (files.length === 0) return null;
    return Snapshot.load(join(storageRoot, files[0]), fsImpl);
  }

  static diff(prev: SnapshotData, current: SnapshotData): SnapshotDiff {
    // Key by plugin name because that is what the user sees and what other
    // detectors key off. A plugin that moves on disk but keeps the same name
    // is treated as "modified", not remove+add.
    const prevPlugins = indexBy(prev.plugins, (p) => p.name);
    const currPlugins = indexBy(current.plugins, (p) => p.name);
    const added: PluginSummary[] = [];
    const removed: PluginSummary[] = [];
    const modified: Array<{ before: PluginSummary; after: PluginSummary }> = [];
    for (const [key, val] of currPlugins) {
      const before = prevPlugins.get(key);
      if (!before) added.push(val);
      else if (!samePluginContent(before, val)) {
        modified.push({ before, after: val });
      }
    }
    for (const [key, val] of prevPlugins) {
      if (!currPlugins.has(key)) removed.push(val);
    }

    const pathAdded: Record<string, string[]> = {};
    const pathRemoved: Record<string, string[]> = {};
    const pathModified: Record<string, { before: string[]; after: string[] }> =
      {};
    const pathKeys = new Set([
      ...Object.keys(prev.pathBinaries),
      ...Object.keys(current.pathBinaries),
    ]);
    for (const key of pathKeys) {
      const before = prev.pathBinaries[key];
      const after = current.pathBinaries[key];
      if (!before) pathAdded[key] = after;
      else if (!after) pathRemoved[key] = before;
      else if (JSON.stringify(before) !== JSON.stringify(after)) {
        pathModified[key] = { before, after };
      }
    }

    const prevMcp = indexBy(prev.settingsMcpServers, (m) => m.name);
    const currMcp = indexBy(current.settingsMcpServers, (m) => m.name);
    const mcpAdded: McpServer[] = [];
    const mcpRemoved: McpServer[] = [];
    for (const [name, val] of currMcp)
      if (!prevMcp.has(name)) mcpAdded.push(val);
    for (const [name, val] of prevMcp)
      if (!currMcp.has(name)) mcpRemoved.push(val);

    const hasChanges =
      added.length > 0 ||
      removed.length > 0 ||
      modified.length > 0 ||
      Object.keys(pathAdded).length > 0 ||
      Object.keys(pathRemoved).length > 0 ||
      Object.keys(pathModified).length > 0 ||
      mcpAdded.length > 0 ||
      mcpRemoved.length > 0;

    return {
      plugins: { added, removed, modified },
      settingsMcpServers: { added: mcpAdded, removed: mcpRemoved },
      pathBinaries: {
        added: pathAdded,
        removed: pathRemoved,
        modified: pathModified,
      },
      hasChanges,
    };
  }

  // =====================================================================
  // Plugin discovery
  // =====================================================================

  /**
   * Walk `<globalRoot>/plugins/cache/<marketplace>/<plugin>/<version>/`
   * exactly 3 levels deep. Tags each discovered plugin with
   * `source: 'plugin-cache'`.
   */
  private async capturePluginsFromCache(
    globalRoot: string,
  ): Promise<PluginSummary[]> {
    const cacheDir = join(globalRoot, "plugins", "cache");
    if (!(await isDir(cacheDir, this.fs))) return [];
    const results: PluginSummary[] = [];
    const l1 = await safeReaddir(cacheDir, this.fs);
    for (const m of l1) {
      const marketDir = join(cacheDir, m);
      if (!(await isDir(marketDir, this.fs))) continue;
      const l2 = await safeReaddir(marketDir, this.fs);
      for (const p of l2) {
        const pluginDir = join(marketDir, p);
        if (!(await isDir(pluginDir, this.fs))) continue;
        const l3 = await safeReaddir(pluginDir, this.fs);
        for (const v of l3) {
          // `.claude-plugin` is a manifest subdirectory, not a version.
          // Treating it as a version dir would misread a misplaced plugin.json
          // and bypass the 3-level depth requirement.
          if (v === ".claude-plugin") continue;
          const versionDir = join(pluginDir, v);
          if (!(await isDir(versionDir, this.fs))) continue;
          if (await isPluginRoot(versionDir, this.fs)) {
            const summary = await this.capturePlugin(
              versionDir,
              "plugin-cache",
            );
            if (summary) results.push(summary);
          }
        }
      }
    }
    return results;
  }

  /**
   * Walk `<globalRoot>/plugins/marketplaces/<marketplace>/`. The marketplace
   * root itself is treated as a plugin root when `.claude-plugin/marketplace.json`
   * exists (hooks/skills/agents sit at the top level). Nested
   * `plugins/<plugin>/` directories are also captured.
   */
  private async capturePluginsFromMarketplaces(
    globalRoot: string,
  ): Promise<PluginSummary[]> {
    const mpDir = join(globalRoot, "plugins", "marketplaces");
    if (!(await isDir(mpDir, this.fs))) return [];
    const results: PluginSummary[] = [];
    const entries = await safeReaddir(mpDir, this.fs);
    for (const e of entries) {
      const marketRoot = join(mpDir, e);
      if (!(await isDir(marketRoot, this.fs))) continue;
      // Marketplace root as plugin (manifest may be plugin.json OR marketplace.json).
      if (
        await hasAnyManifest(marketRoot, this.fs, [
          "plugin.json",
          "marketplace.json",
        ])
      ) {
        const summary = await this.capturePlugin(
          marketRoot,
          "plugin-marketplace",
          { manifestNames: ["plugin.json", "marketplace.json"] },
        );
        if (summary) results.push(summary);
      }
      // Nested plugins/<plugin>/ directories.
      const nestedPluginsDir = join(marketRoot, "plugins");
      if (await isDir(nestedPluginsDir, this.fs)) {
        const nested = await safeReaddir(nestedPluginsDir, this.fs);
        for (const n of nested) {
          const nestedRoot = join(nestedPluginsDir, n);
          if (!(await isDir(nestedRoot, this.fs))) continue;
          if (await isPluginRoot(nestedRoot, this.fs)) {
            const summary = await this.capturePlugin(
              nestedRoot,
              "plugin-marketplace",
            );
            if (summary) results.push(summary);
          }
        }
      }
    }
    return results;
  }

  /**
   * Legacy flat `<root>/plugins/` walk (v0.1 layout). Kept so the existing
   * test fixtures continue to pass; real-world installs use cache/marketplace
   * paths instead.
   */
  private async capturePluginsFromLegacy(
    baseDir: string,
  ): Promise<PluginSummary[]> {
    const pluginsDir = join(baseDir, "plugins");
    if (!(await isDir(pluginsDir, this.fs))) return [];
    const out: PluginSummary[] = [];
    const l1 = await safeReaddir(pluginsDir, this.fs);
    for (const e1 of l1) {
      const p1 = join(pluginsDir, e1);
      if (!(await isDir(p1, this.fs))) continue;
      // Skip cache/ and marketplaces/ — handled by dedicated walkers.
      if (e1 === "cache" || e1 === "marketplaces") continue;
      if (await isPluginRoot(p1, this.fs)) {
        const summary = await this.capturePlugin(p1, "plugin-cache");
        if (summary) out.push(summary);
      } else {
        const l2 = await safeReaddir(p1, this.fs);
        for (const e2 of l2) {
          const p2 = join(p1, e2);
          if ((await isDir(p2, this.fs)) && (await isPluginRoot(p2, this.fs))) {
            const summary = await this.capturePlugin(p2, "plugin-cache");
            if (summary) out.push(summary);
          }
        }
      }
    }
    return out;
  }

  private async capturePlugin(
    pluginRoot: string,
    source: HookSource,
    opts: { manifestNames?: string[] } = {},
  ): Promise<PluginSummary | null> {
    const pluginJson = await readPluginJson(
      pluginRoot,
      this.fs,
      opts.manifestNames,
    );
    if (!pluginJson) return null;
    const name =
      typeof pluginJson.name === "string"
        ? pluginJson.name
        : (pluginRoot.split(sep).pop() ?? pluginRoot);

    const commands = await normalizeCommands(pluginRoot, pluginJson, this.fs);
    const hookEvents = await captureHookEvents(pluginRoot, this.fs, source);
    const skills = await normalizeSkills(pluginRoot, pluginJson, this.fs);
    const agents = await normalizeAgents(pluginRoot, pluginJson, this.fs);
    const mcpServers = await normalizeMcpServers(
      pluginRoot,
      pluginJson,
      this.fs,
    );
    return {
      name,
      pluginRoot,
      commands,
      hookEvents,
      skills,
      agents,
      mcpServers,
      source,
      enabled: true,
    };
  }

  // =====================================================================
  // Settings capture
  // =====================================================================

  /**
   * Read `<globalRoot>/settings.json`, `<globalRoot>/settings.local.json`,
   * plus Delta 1 (`~/.claude.json`) and Delta 2a (managed-settings path).
   */
  private async captureUserSettings(
    globalRoot: string,
  ): Promise<SettingsCapture> {
    const out = emptySettingsCapture();

    await this.mergeSettingsFile(
      join(globalRoot, "settings.json"),
      "user-settings",
      out,
    );
    await this.mergeSettingsFile(
      join(globalRoot, "settings.local.json"),
      "user-settings-local",
      out,
    );

    // Delta 1: probe ~/.claude.json for a top-level `mcpServers` map.
    const homeMcpPath =
      this.options.homeMcpConfigPath ?? defaultHomeMcpConfigPath();
    await this.mergeHomeMcpFile(homeMcpPath, out);

    // Delta 2a: probe managed settings (explicit null disables).
    const managedPath =
      this.options.managedSettingsPath === undefined
        ? defaultManagedSettingsPath()
        : this.options.managedSettingsPath;
    if (managedPath) {
      await this.mergeSettingsFile(managedPath, "user-managed", out);
    }

    return out;
  }

  /** Read `<projectRoot>/.claude/settings.json` + `...local.json`. */
  private async captureProjectSettings(
    projectRoot: string,
  ): Promise<SettingsCapture> {
    const out = emptySettingsCapture();
    const dir = join(projectRoot, ".claude");
    await this.mergeSettingsFile(
      join(dir, "settings.json"),
      "project-settings",
      out,
    );
    await this.mergeSettingsFile(
      join(dir, "settings.local.json"),
      "project-settings-local",
      out,
    );
    return out;
  }

  private async mergeSettingsFile(
    path: string,
    source: HookSource,
    into: SettingsCapture,
  ): Promise<void> {
    const parsed = await readJsonSafe(path, this.fs);
    if (!parsed || typeof parsed !== "object") return;
    const obj = parsed as Record<string, unknown>;

    // Hooks.
    if (obj.hooks && typeof obj.hooks === "object") {
      const hooks = obj.hooks as Record<string, unknown>;
      for (const [event, entries] of Object.entries(hooks)) {
        if (!Array.isArray(entries)) continue;
        for (const entry of entries) {
          if (!entry || typeof entry !== "object") continue;
          const e = entry as {
            matcher?: string;
            hooks?: unknown;
          };
          const hookList = normalizeSettingsHookScripts(e.hooks);
          into.settingsHooks.push({
            event,
            matcher: typeof e.matcher === "string" ? e.matcher : undefined,
            hooks: hookList,
            source,
          });
        }
      }
    }

    // MCP servers.
    if (obj.mcpServers && typeof obj.mcpServers === "object") {
      into.mcpServers.push(
        ...mcpServersFromObject(obj.mcpServers as Record<string, unknown>),
      );
    }

    // Enabled plugins.
    if (obj.enabledPlugins && typeof obj.enabledPlugins === "object") {
      for (const [k, v] of Object.entries(
        obj.enabledPlugins as Record<string, unknown>,
      )) {
        if (typeof v === "boolean") into.enabledPlugins[k] = v;
      }
    }
  }

  /**
   * Delta 1: Read `~/.claude.json` and merge `.mcpServers` into the
   * user-level MCP list. Silent no-op when the file is absent.
   */
  private async mergeHomeMcpFile(
    path: string,
    into: SettingsCapture,
  ): Promise<void> {
    const parsed = await readJsonSafe(path, this.fs);
    if (!parsed || typeof parsed !== "object") return;
    const mcp = (parsed as Record<string, unknown>).mcpServers;
    if (!mcp || typeof mcp !== "object") return;
    into.mcpServers.push(
      ...mcpServersFromObject(mcp as Record<string, unknown>),
    );
  }

  // =====================================================================
  // PATH binaries
  // =====================================================================

  private async capturePathBinaries(
    pathEnv: string,
  ): Promise<Record<string, string[]>> {
    const dirs = pathEnv.split(delimiter).filter((d) => d.length > 0);
    const out: Record<string, string[]> = {};
    for (const dir of dirs) {
      if (!(await isDir(dir, this.fs))) continue;
      const entries = await safeReaddir(dir, this.fs);
      for (const name of entries) {
        if (!name || name.startsWith(".")) continue;
        const full = join(dir, name);
        out[name] ??= [];
        if (!out[name].includes(full)) out[name].push(full);
      }
    }
    return out;
  }

  // =====================================================================
  // Fingerprint
  // =====================================================================

  private fingerprint(body: Omit<SnapshotData, "fingerprint">): string {
    const h = createHash("sha256");
    const stable = JSON.stringify(body, (_key, val) =>
      val && typeof val === "object" && !Array.isArray(val)
        ? Object.keys(val)
            .sort()
            .reduce<Record<string, unknown>>((acc, k) => {
              acc[k] = (val as Record<string, unknown>)[k];
              return acc;
            }, {})
        : val,
    );
    h.update(stable);
    return h.digest("hex");
  }
}

/** Keep at most `keep` snapshot files in `storageRoot`, deleting the oldest. */
export async function pruneSnapshots(
  storageRoot: string,
  keep = 2,
  fsImpl: typeof fs = fs,
): Promise<void> {
  return pruneSnapshotsImpl(storageRoot, keep, fsImpl);
}

// ===========================================================================
// Internal helpers
// ===========================================================================

interface SettingsCapture {
  settingsHooks: SettingsHookEntry[];
  mcpServers: McpServer[];
  enabledPlugins: Record<string, boolean>;
}

function emptySettingsCapture(): SettingsCapture {
  return { settingsHooks: [], mcpServers: [], enabledPlugins: {} };
}

async function pruneSnapshotsImpl(
  storageRoot: string,
  keep: number,
  fsImpl: typeof fs,
): Promise<void> {
  const files = await listSnapshotFiles(storageRoot, fsImpl);
  const excess = files.slice(keep);
  for (const file of excess) {
    await fsImpl.unlink(join(storageRoot, file)).catch(() => undefined);
  }
}

async function listSnapshotFiles(
  storageRoot: string,
  fsImpl: typeof fs,
): Promise<string[]> {
  if (!(await pathExists(storageRoot, fsImpl))) return [];
  const entries = await safeReaddir(storageRoot, fsImpl);
  const files = entries.filter(
    (f) => f.startsWith("snapshot-") && f.endsWith(".json"),
  );
  // newest first (lexical sort on ISO timestamp in filename)
  return files.sort().reverse();
}

async function captureHookEvents(
  pluginRoot: string,
  fsImpl: typeof fs,
  source: HookSource,
): Promise<Record<string, HookRegistration[]>> {
  const hooksPath = join(pluginRoot, "hooks", "hooks.json");
  if (!(await pathExists(hooksPath, fsImpl))) return {};
  try {
    const raw = await fsImpl.readFile(hooksPath, "utf8");
    const parsed = JSON.parse(raw) as {
      hooks?: Record<string, unknown>;
    };
    const hooks = parsed.hooks ?? {};
    const out: Record<string, HookRegistration[]> = {};
    for (const [event, entries] of Object.entries(hooks)) {
      if (!Array.isArray(entries)) continue;
      const registrations: HookRegistration[] = [];
      for (const entry of entries) {
        if (!entry || typeof entry !== "object") continue;
        const e = entry as { matcher?: string; hooks?: unknown };
        const hookList: HookScript[] = [];
        for (const h of Array.isArray(e.hooks) ? e.hooks : []) {
          if (!h || typeof h !== "object") continue;
          const script = h as Record<string, unknown>;
          const command =
            typeof script.command === "string" ? script.command : "";
          const kind = classifyHookKind(script.type);
          const hookScript: HookScript = {
            command,
            kind,
            rawConfig: script,
          };
          // Only command-type hooks get source/path resolution; non-command
          // entries (prompt/agent/http) have no filesystem script to read.
          if (kind === "command" && command.length > 0) {
            const resolved = await resolveHookScript(
              pluginRoot,
              command,
              fsImpl,
            );
            if (resolved.path) hookScript.scriptPath = resolved.path;
            if (resolved.source) hookScript.scriptSource = resolved.source;
          }
          hookList.push(hookScript);
        }
        registrations.push({
          matcher: typeof e.matcher === "string" ? e.matcher : undefined,
          hooks: hookList,
          source,
        });
      }
      out[event] = registrations;
    }
    return out;
  } catch {
    return {};
  }
}

function normalizeSettingsHookScripts(raw: unknown): HookScript[] {
  if (!Array.isArray(raw)) return [];
  const out: HookScript[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const script = entry as Record<string, unknown>;
    const command = typeof script.command === "string" ? script.command : "";
    const kind = classifyHookKind(script.type);
    out.push({ command, kind, rawConfig: script });
  }
  return out;
}

function classifyHookKind(type: unknown): HookScript["kind"] {
  if (typeof type !== "string" || type.length === 0) return "command";
  switch (type) {
    case "command":
    case "prompt":
    case "agent":
    case "http":
      return type;
    default:
      return "unknown";
  }
}

async function resolveHookScript(
  pluginRoot: string,
  rawCommand: string,
  fsImpl: typeof fs,
): Promise<{ path?: string; source?: string }> {
  const withRoot = rawCommand.replaceAll("$CLAUDE_PLUGIN_ROOT", pluginRoot);
  const match =
    withRoot.match(/(?:^|\s)(\S+\.m?js|\S+\.sh|\S+\.py)(?=\s|$)/) ?? null;
  if (!match) return {};
  const candidate = stripQuotes(match[1]);
  const abs = resolve(pluginRoot, candidate);
  if (!(await pathExists(abs, fsImpl))) return { path: candidate };
  // Symlink-containment guard: refuse to read a hook script whose realpath
  // escapes the plugin root.
  try {
    const realAbs = await fsImpl.realpath(abs);
    const realRoot = await fsImpl.realpath(pluginRoot);
    if (realAbs !== realRoot && !realAbs.startsWith(realRoot + sep)) {
      return { path: abs };
    }
    const stat = await fsImpl.stat(realAbs);
    if (!stat.isFile()) return { path: abs };
    const buf = await fsImpl.readFile(realAbs);
    const truncated = buf.subarray(0, HOOK_SCRIPT_MAX_BYTES).toString("utf8");
    return { path: abs, source: truncated };
  } catch {
    return { path: abs };
  }
}

// =====================================================================
// plugin.json field normalizers
// =====================================================================

async function normalizeCommands(
  pluginRoot: string,
  pluginJson: Record<string, unknown>,
  _fsImpl: typeof fs,
): Promise<PluginCommand[]> {
  const raw = pluginJson.commands;
  if (!Array.isArray(raw)) return [];
  const out: PluginCommand[] = [];
  for (const entry of raw) {
    if (typeof entry === "string") {
      const name = commandBaseName(entry);
      if (name) out.push({ name, path: entry });
    } else if (entry && typeof entry === "object") {
      const obj = entry as Record<string, unknown>;
      const name =
        typeof obj.name === "string"
          ? obj.name
          : typeof obj.file === "string"
            ? commandBaseName(obj.file as string)
            : undefined;
      if (name)
        out.push({
          name,
          path: typeof obj.file === "string" ? (obj.file as string) : undefined,
        });
    }
  }
  return out;
}

/**
 * `plugin.json.skills` can be:
 *   - string pointing to a dir (trailing slash or not) -> walk dir for SKILL.md / *.md
 *   - string pointing to a single .md file -> single skill
 *   - array of strings (paths)
 *   - array of objects (unused in observed installs but tolerated)
 *   - absent -> fall back to walking `<pluginRoot>/skills/` when it exists
 */
async function normalizeSkills(
  pluginRoot: string,
  pluginJson: Record<string, unknown>,
  fsImpl: typeof fs,
): Promise<PluginSkill[]> {
  const raw = pluginJson.skills;
  const targets: string[] = [];
  if (typeof raw === "string") targets.push(raw);
  else if (Array.isArray(raw)) {
    for (const e of raw) {
      if (typeof e === "string") targets.push(e);
      else if (e && typeof e === "object" && typeof (e as { path?: unknown }).path === "string") {
        targets.push((e as { path: string }).path);
      }
    }
  }

  // Fallback: walk `<pluginRoot>/skills/` when plugin.json does not declare it.
  if (targets.length === 0) {
    const defaultDir = join(pluginRoot, "skills");
    if (await isDir(defaultDir, fsImpl)) targets.push("skills");
  }

  const out: PluginSkill[] = [];
  const seenPaths = new Set<string>();
  for (const target of targets) {
    const absTarget = resolve(pluginRoot, target);
    if (await isDir(absTarget, fsImpl)) {
      // Walk for skill md files. Both `<dir>/<name>/SKILL.md` and `<dir>/<name>.md`.
      const entries = await safeReaddir(absTarget, fsImpl);
      for (const entry of entries) {
        const entryPath = join(absTarget, entry);
        if (await isDir(entryPath, fsImpl)) {
          const nested = join(entryPath, "SKILL.md");
          if (await isFile(nested, fsImpl) && !seenPaths.has(nested)) {
            seenPaths.add(nested);
            out.push(await readSkillFile(nested, entry, fsImpl));
          }
        } else if (entry.endsWith(".md") && (await isFile(entryPath, fsImpl))) {
          if (seenPaths.has(entryPath)) continue;
          seenPaths.add(entryPath);
          out.push(
            await readSkillFile(entryPath, entry.replace(/\.md$/, ""), fsImpl),
          );
        }
      }
    } else if (await isFile(absTarget, fsImpl)) {
      if (seenPaths.has(absTarget)) continue;
      seenPaths.add(absTarget);
      // Single file: derive name from parent dir if it's SKILL.md, else from filename.
      const base = absTarget.split(sep).pop() ?? "";
      const fallbackName =
        base === "SKILL.md"
          ? (absTarget.split(sep).slice(-2, -1)[0] ?? "skill")
          : base.replace(/\.md$/, "");
      out.push(await readSkillFile(absTarget, fallbackName, fsImpl));
    }
  }
  return out;
}

async function readSkillFile(
  filePath: string,
  fallbackName: string,
  fsImpl: typeof fs,
): Promise<PluginSkill> {
  const parsed = await parseMdFrontmatter(filePath, fsImpl);
  const name =
    parsed && typeof parsed.fields.name === "string"
      ? parsed.fields.name
      : fallbackName;
  const triggerKeywords = extractTriggerKeywords(parsed?.fields ?? {});
  const skill: PluginSkill = { name, triggerKeywords };
  if (parsed && parsed.parseWarnings.length > 0) {
    skill.parseWarnings = parsed.parseWarnings;
  }
  return skill;
}

/**
 * `plugin.json.agents` can be:
 *   - array of string paths -> each .md file
 *   - absent -> walk `<pluginRoot>/agents/` when it exists
 */
async function normalizeAgents(
  pluginRoot: string,
  pluginJson: Record<string, unknown>,
  fsImpl: typeof fs,
): Promise<PluginAgent[]> {
  const raw = pluginJson.agents;
  const targets: string[] = [];
  if (typeof raw === "string") targets.push(raw);
  else if (Array.isArray(raw)) {
    for (const e of raw) {
      if (typeof e === "string") targets.push(e);
    }
  }

  if (targets.length === 0) {
    const defaultDir = join(pluginRoot, "agents");
    if (await isDir(defaultDir, fsImpl)) targets.push("agents");
  }

  const out: PluginAgent[] = [];
  const seen = new Set<string>();
  for (const target of targets) {
    const absTarget = resolve(pluginRoot, target);
    if (await isDir(absTarget, fsImpl)) {
      const entries = await safeReaddir(absTarget, fsImpl);
      for (const entry of entries) {
        if (!entry.endsWith(".md")) continue;
        const entryPath = join(absTarget, entry);
        if (!(await isFile(entryPath, fsImpl))) continue;
        if (seen.has(entryPath)) continue;
        seen.add(entryPath);
        out.push(await readAgentFile(entryPath, entry.replace(/\.md$/, ""), fsImpl));
      }
    } else if (
      absTarget.endsWith(".md") &&
      (await isFile(absTarget, fsImpl))
    ) {
      if (seen.has(absTarget)) continue;
      seen.add(absTarget);
      const base = absTarget.split(sep).pop() ?? "";
      out.push(await readAgentFile(absTarget, base.replace(/\.md$/, ""), fsImpl));
    }
  }
  return out;
}

async function readAgentFile(
  filePath: string,
  fallbackName: string,
  fsImpl: typeof fs,
): Promise<PluginAgent> {
  const parsed = await parseMdFrontmatter(filePath, fsImpl);
  const name =
    parsed && typeof parsed.fields.name === "string"
      ? parsed.fields.name
      : fallbackName;
  const agent: PluginAgent = { name };
  if (parsed && parsed.parseWarnings.length > 0) {
    agent.parseWarnings = parsed.parseWarnings;
  }
  return agent;
}

/**
 * `plugin.json.mcpServers` can be:
 *   - string path to a `.mcp.json` file -> read file, extract `.mcpServers`
 *   - inline object `{ name: { ... } }`
 *   - absent -> empty
 */
async function normalizeMcpServers(
  pluginRoot: string,
  pluginJson: Record<string, unknown>,
  fsImpl: typeof fs,
): Promise<McpServer[]> {
  const raw = pluginJson.mcpServers;
  if (typeof raw === "string") {
    const abs = resolve(pluginRoot, raw);
    const parsed = await readJsonSafe(abs, fsImpl);
    if (parsed && typeof parsed === "object") {
      const obj = parsed as Record<string, unknown>;
      // Observed: `.mcp.json` files may have the map at top level OR under `.mcpServers`.
      const candidate =
        obj.mcpServers && typeof obj.mcpServers === "object"
          ? (obj.mcpServers as Record<string, unknown>)
          : obj;
      return mcpServersFromObject(candidate, "plugin");
    }
    return [];
  }
  if (raw && typeof raw === "object") {
    return mcpServersFromObject(raw as Record<string, unknown>, "plugin");
  }
  return [];
}

function mcpServersFromObject(
  obj: Record<string, unknown>,
  source: McpServer["source"] = "settings",
): McpServer[] {
  const out: McpServer[] = [];
  for (const [name, cfg] of Object.entries(obj)) {
    if (!cfg || typeof cfg !== "object") continue;
    const tools = (cfg as { tools?: unknown }).tools;
    out.push({
      name,
      tools: Array.isArray(tools)
        ? tools.filter((t): t is string => typeof t === "string")
        : [],
      source,
    });
  }
  return out;
}

function dedupeMcpByName(servers: McpServer[]): McpServer[] {
  const seen = new Set<string>();
  const out: McpServer[] = [];
  for (const s of servers) {
    if (seen.has(s.name)) continue;
    seen.add(s.name);
    out.push(s);
  }
  return out;
}

function dedupePluginsByRoot(plugins: PluginSummary[]): PluginSummary[] {
  const seen = new Set<string>();
  const out: PluginSummary[] = [];
  for (const p of plugins) {
    if (seen.has(p.pluginRoot)) continue;
    seen.add(p.pluginRoot);
    out.push(p);
  }
  return out;
}

function applyEnabledPluginsFilter(
  plugins: PluginSummary[],
  enabledMap: Record<string, boolean>,
): PluginSummary[] {
  return plugins.map((p) => {
    // Empty map means no overrides -> keep existing enabled: true.
    if (Object.prototype.hasOwnProperty.call(enabledMap, p.name)) {
      return { ...p, enabled: enabledMap[p.name] };
    }
    return p;
  });
}

function commandBaseName(pathOrName: string): string | null {
  const last = pathOrName.split("/").pop() ?? pathOrName;
  const stripped = last.replace(/\.md$/, "");
  return stripped.length > 0 ? stripped : null;
}

async function readPluginJson(
  pluginRoot: string,
  fsImpl: typeof fs,
  manifestNames: string[] = ["plugin.json"],
): Promise<Record<string, unknown> | null> {
  const candidates: string[] = [];
  for (const name of manifestNames) {
    candidates.push(join(pluginRoot, ".claude-plugin", name));
    candidates.push(join(pluginRoot, name));
  }
  for (const candidate of candidates) {
    if (await isFile(candidate, fsImpl)) {
      try {
        const raw = await fsImpl.readFile(candidate, "utf8");
        return JSON.parse(raw) as Record<string, unknown>;
      } catch {
        return null;
      }
    }
  }
  return null;
}

async function isPluginRoot(
  path: string,
  fsImpl: typeof fs,
): Promise<boolean> {
  return hasAnyManifest(path, fsImpl, ["plugin.json"]);
}

async function hasAnyManifest(
  path: string,
  fsImpl: typeof fs,
  names: string[],
): Promise<boolean> {
  for (const n of names) {
    if (await isFile(join(path, ".claude-plugin", n), fsImpl)) return true;
    if (await isFile(join(path, n), fsImpl)) return true;
  }
  return false;
}

async function parseMdFrontmatter(
  path: string,
  fsImpl: typeof fs,
): Promise<ParsedFrontmatter | null> {
  try {
    const raw = await fsImpl.readFile(path, "utf8");
    const fmText = extractFrontmatter(raw);
    if (fmText === null) return { fields: {}, parseWarnings: [] };
    return parseYamlSubset(fmText);
  } catch {
    return null;
  }
}

function extractTriggerKeywords(
  frontmatter: Record<string, unknown>,
): string[] {
  const candidates = ["triggers", "keywords", "trigger", "trigger-keywords"];
  for (const key of candidates) {
    const val = frontmatter[key];
    if (typeof val === "string") {
      return val
        .split(/[,\s]+/)
        .map((s) => s.trim())
        .filter(Boolean);
    }
    if (Array.isArray(val)) {
      return val.filter((s): s is string => typeof s === "string");
    }
  }
  return [];
}

async function isDir(p: string, fsImpl: typeof fs): Promise<boolean> {
  try {
    const stat = await fsImpl.stat(p);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

async function isFile(p: string, fsImpl: typeof fs): Promise<boolean> {
  try {
    const stat = await fsImpl.stat(p);
    return stat.isFile();
  } catch {
    return false;
  }
}

async function pathExists(p: string, fsImpl: typeof fs): Promise<boolean> {
  try {
    await fsImpl.stat(p);
    return true;
  } catch {
    return false;
  }
}

async function safeReaddir(
  p: string,
  fsImpl: typeof fs,
): Promise<string[]> {
  try {
    return await fsImpl.readdir(p);
  } catch {
    return [];
  }
}

async function readJsonSafe(
  path: string,
  fsImpl: typeof fs,
): Promise<unknown> {
  if (!(await pathExists(path, fsImpl))) return null;
  try {
    const raw = await fsImpl.readFile(path, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function stripQuotes(s: string): string {
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  )
    return s.slice(1, -1);
  return s;
}

function indexBy<T>(items: T[], key: (item: T) => string): Map<string, T> {
  const m = new Map<string, T>();
  for (const item of items) m.set(key(item), item);
  return m;
}

/**
 * Compare two plugin summaries for equivalence, ignoring their absolute
 * pluginRoot path (which can shift between sessions without the plugin
 * actually changing).
 */
function samePluginContent(a: PluginSummary, b: PluginSummary): boolean {
  const strip = (s: PluginSummary) => ({ ...s, pluginRoot: "" });
  return JSON.stringify(strip(a)) === JSON.stringify(strip(b));
}

