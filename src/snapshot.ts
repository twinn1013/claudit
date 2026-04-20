import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { delimiter, join, resolve, sep } from "node:path";
import { homedir } from "node:os";
import type {
  HookRegistration,
  HookScript,
  McpServer,
  PluginAgent,
  PluginCommand,
  PluginSkill,
  PluginSummary,
  SnapshotData,
} from "./types.js";

/** Default global root — `~/.claude/`. */
export const defaultGlobalRoot = (): string => join(homedir(), ".claude");

/** Default snapshot storage directory — `~/.claude/claudit/snapshots/`. */
export const defaultSnapshotStorage = (): string =>
  join(homedir(), ".claude", "claudit", "snapshots");

/** Cap per-hook-script source read at 4KB for static analysis. */
const HOOK_SCRIPT_MAX_BYTES = 4 * 1024;
/** Snapshot files must stay under 1MB. */
export const SNAPSHOT_SIZE_LIMIT = 1024 * 1024;

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
 * Snapshots are content-addressed (via fingerprint), JSON-serializable, and
 * capped at {@link SNAPSHOT_SIZE_LIMIT} so per-event writes stay cheap.
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
    const plugins = await this.capturePluginsFromRoots([
      ...(await this.resolvePluginRoots(globalRoot)),
      ...(projectRoot ? await this.resolvePluginRoots(projectRoot) : []),
    ]);
    const settingsMcpServers = await this.captureSettingsMcpServers(globalRoot);
    const pathBinaries = await this.capturePathBinaries(
      this.options.pathOverride ?? process.env.PATH ?? "",
    );
    const capturedAt = new Date().toISOString();
    const body: Omit<SnapshotData, "fingerprint"> = {
      globalRoot,
      projectRoot,
      plugins,
      settingsMcpServers,
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

  // ---------------------------------------------------------------------

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

  /**
   * Find plugin roots under a CC-style base directory (global or project).
   * A plugin root is any directory containing .claude-plugin/plugin.json
   * or plugin.json at the root. We scan one and two levels under the
   * plugins directory to handle marketplace-nested installs.
   */
  private async resolvePluginRoots(baseDir: string): Promise<string[]> {
    const pluginsDir = join(baseDir, "plugins");
    if (!(await pathExists(pluginsDir, this.fs))) return [];
    const roots: string[] = [];
    const level1 = await safeReaddir(pluginsDir, this.fs);
    for (const e1 of level1) {
      const p1 = join(pluginsDir, e1);
      if (!(await isDir(p1, this.fs))) continue;
      if (await isPluginRoot(p1, this.fs)) roots.push(p1);
      else {
        const level2 = await safeReaddir(p1, this.fs);
        for (const e2 of level2) {
          const p2 = join(p1, e2);
          if ((await isDir(p2, this.fs)) && (await isPluginRoot(p2, this.fs))) {
            roots.push(p2);
          }
        }
      }
    }
    return roots;
  }

  private async capturePluginsFromRoots(
    roots: string[],
  ): Promise<PluginSummary[]> {
    const out: PluginSummary[] = [];
    for (const root of roots) {
      const summary = await this.capturePlugin(root);
      if (summary) out.push(summary);
    }
    return out.sort((a, b) => a.pluginRoot.localeCompare(b.pluginRoot));
  }

  private async capturePlugin(
    pluginRoot: string,
  ): Promise<PluginSummary | null> {
    const pluginJson = await readPluginJson(pluginRoot, this.fs);
    if (!pluginJson) return null;
    const name =
      typeof pluginJson.name === "string"
        ? pluginJson.name
        : pluginRoot.split(sep).pop() ?? pluginRoot;

    const commands = extractCommands(pluginJson);
    const hookEvents = await captureHookEvents(pluginRoot, this.fs);
    const skills = await captureSkills(pluginRoot, this.fs);
    const agents = await captureAgents(pluginRoot, this.fs);
    const mcpServers = extractPluginMcpServers(pluginJson);
    return { name, pluginRoot, commands, hookEvents, skills, agents, mcpServers };
  }

  private async captureSettingsMcpServers(
    globalRoot: string,
  ): Promise<McpServer[]> {
    const settingsPath = join(globalRoot, "settings.json");
    if (!(await pathExists(settingsPath, this.fs))) return [];
    try {
      const raw = await this.fs.readFile(settingsPath, "utf8");
      const parsed = JSON.parse(raw) as {
        mcpServers?: Record<string, { tools?: string[] }>;
      };
      const servers = parsed.mcpServers;
      if (!servers || typeof servers !== "object") return [];
      return Object.entries(servers).map(([name, cfg]) => ({
        name,
        tools: Array.isArray(cfg.tools) ? [...cfg.tools] : [],
        source: "settings" as const,
      }));
    } catch {
      return [];
    }
  }

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
): Promise<Record<string, HookRegistration[]>> {
  const hooksPath = join(pluginRoot, "hooks", "hooks.json");
  if (!(await pathExists(hooksPath, fsImpl))) return {};
  try {
    const raw = await fsImpl.readFile(hooksPath, "utf8");
    const parsed = JSON.parse(raw) as {
      hooks?: Record<
        string,
        Array<{
          matcher?: string;
          hooks?: Array<{ type?: string; command?: string; timeout?: number }>;
        }>
      >;
    };
    const hooks = parsed.hooks ?? {};
    const out: Record<string, HookRegistration[]> = {};
    for (const [event, entries] of Object.entries(hooks)) {
      const registrations: HookRegistration[] = [];
      for (const entry of entries ?? []) {
        const hookList: HookScript[] = [];
        for (const h of entry.hooks ?? []) {
          if (typeof h.command !== "string") continue;
          const resolved = await resolveHookScript(
            pluginRoot,
            h.command,
            fsImpl,
          );
          hookList.push({
            command: h.command,
            scriptPath: resolved.path,
            scriptSource: resolved.source,
          });
        }
        registrations.push({ matcher: entry.matcher, hooks: hookList });
      }
      out[event] = registrations;
    }
    return out;
  } catch {
    return {};
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
  try {
    const buf = await fsImpl.readFile(abs);
    const truncated = buf.subarray(0, HOOK_SCRIPT_MAX_BYTES).toString("utf8");
    return { path: abs, source: truncated };
  } catch {
    return { path: abs };
  }
}

async function captureSkills(
  pluginRoot: string,
  fsImpl: typeof fs,
): Promise<PluginSkill[]> {
  const skillsDir = join(pluginRoot, "skills");
  if (!(await isDir(skillsDir, fsImpl))) return [];
  const out: PluginSkill[] = [];
  const entries = await safeReaddir(skillsDir, fsImpl);
  for (const entry of entries) {
    const entryPath = join(skillsDir, entry);
    let mdPath: string | null = null;
    if (entry.endsWith(".md") && (await isFile(entryPath, fsImpl))) {
      mdPath = entryPath;
    } else if (await isDir(entryPath, fsImpl)) {
      const nested = join(entryPath, "SKILL.md");
      if (await isFile(nested, fsImpl)) mdPath = nested;
    }
    if (!mdPath) continue;
    const parsed = await parseMdFrontmatter(mdPath, fsImpl);
    if (!parsed) continue;
    const name =
      typeof parsed.name === "string" ? parsed.name : entry.replace(/\.md$/, "");
    const triggerKeywords = extractTriggerKeywords(parsed);
    out.push({ name, triggerKeywords });
  }
  return out;
}

async function captureAgents(
  pluginRoot: string,
  fsImpl: typeof fs,
): Promise<PluginAgent[]> {
  const agentsDir = join(pluginRoot, "agents");
  if (!(await isDir(agentsDir, fsImpl))) return [];
  const out: PluginAgent[] = [];
  const entries = await safeReaddir(agentsDir, fsImpl);
  for (const entry of entries) {
    if (!entry.endsWith(".md")) continue;
    const parsed = await parseMdFrontmatter(join(agentsDir, entry), fsImpl);
    const type =
      (parsed && typeof parsed.name === "string" && parsed.name) ||
      entry.replace(/\.md$/, "");
    out.push({ type });
  }
  return out;
}

function extractCommands(
  pluginJson: Record<string, unknown>,
): PluginCommand[] {
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

function extractPluginMcpServers(
  pluginJson: Record<string, unknown>,
): McpServer[] {
  const raw = pluginJson.mcpServers;
  if (!raw || typeof raw !== "object") return [];
  return Object.entries(raw as Record<string, { tools?: unknown }>).map(
    ([name, cfg]) => ({
      name,
      tools: Array.isArray(cfg?.tools)
        ? (cfg.tools as unknown[]).filter(
            (t): t is string => typeof t === "string",
          )
        : [],
      source: "plugin" as const,
    }),
  );
}

function commandBaseName(pathOrName: string): string | null {
  const last = pathOrName.split("/").pop() ?? pathOrName;
  const stripped = last.replace(/\.md$/, "");
  return stripped.length > 0 ? stripped : null;
}

async function readPluginJson(
  pluginRoot: string,
  fsImpl: typeof fs,
): Promise<Record<string, unknown> | null> {
  const candidates = [
    join(pluginRoot, ".claude-plugin", "plugin.json"),
    join(pluginRoot, "plugin.json"),
  ];
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
  return (
    (await isFile(join(path, ".claude-plugin", "plugin.json"), fsImpl)) ||
    (await isFile(join(path, "plugin.json"), fsImpl))
  );
}

async function parseMdFrontmatter(
  path: string,
  fsImpl: typeof fs,
): Promise<Record<string, unknown> | null> {
  try {
    const raw = await fsImpl.readFile(path, "utf8");
    if (!raw.startsWith("---")) return {};
    const end = raw.indexOf("\n---", 3);
    if (end === -1) return {};
    const body = raw.slice(3, end).trim();
    const obj: Record<string, unknown> = {};
    for (const line of body.split("\n")) {
      const m = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
      if (!m) continue;
      const [, k, v] = m;
      obj[k] = v.trim();
    }
    return obj;
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
