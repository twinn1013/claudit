import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function makeTempDir(prefix = "claudit-"): Promise<string> {
  return fs.mkdtemp(join(tmpdir(), prefix));
}

export interface FakePluginSpec {
  name: string;
  commands?: string[]; // command file names, e.g., "scan.md"
  hookEvents?: Record<
    string,
    Array<{
      matcher?: string;
      hooks: Array<{ type: string; command: string; timeout?: number }>;
    }>
  >;
  /** Map of relative path -> source to write under pluginRoot. */
  hookScripts?: Record<string, string>;
  skills?: Array<{ name: string; triggers?: string[] }>;
  agents?: string[];
  mcpServers?: Record<string, { tools: string[] }>;
}

/**
 * Lay out a fake global root with the given plugins under <root>/plugins/.
 * Returns the global root path.
 */
export async function makeGlobalRoot(
  plugins: FakePluginSpec[],
  extras: {
    settingsMcpServers?: Record<string, { tools: string[] }>;
  } = {},
): Promise<string> {
  const root = await makeTempDir("claudit-global-");
  const pluginsDir = join(root, "plugins");
  await fs.mkdir(pluginsDir, { recursive: true });
  for (const p of plugins) {
    await writeFakePlugin(join(pluginsDir, p.name), p);
  }
  if (extras.settingsMcpServers) {
    await fs.writeFile(
      join(root, "settings.json"),
      JSON.stringify({ mcpServers: extras.settingsMcpServers }),
      "utf8",
    );
  }
  return root;
}

export async function writeFakePlugin(
  pluginRoot: string,
  spec: FakePluginSpec,
): Promise<void> {
  await fs.mkdir(join(pluginRoot, ".claude-plugin"), { recursive: true });
  const pluginJson: Record<string, unknown> = { name: spec.name };
  if (spec.commands?.length) {
    pluginJson.commands = spec.commands.map((c) => `./commands/${c}`);
  }
  if (spec.mcpServers) pluginJson.mcpServers = spec.mcpServers;
  await fs.writeFile(
    join(pluginRoot, ".claude-plugin", "plugin.json"),
    JSON.stringify(pluginJson),
    "utf8",
  );
  if (spec.commands?.length) {
    await fs.mkdir(join(pluginRoot, "commands"), { recursive: true });
    for (const c of spec.commands) {
      await fs.writeFile(
        join(pluginRoot, "commands", c),
        `---\ndescription: ${c}\n---\nfake\n`,
        "utf8",
      );
    }
  }
  if (spec.hookEvents) {
    await fs.mkdir(join(pluginRoot, "hooks"), { recursive: true });
    await fs.writeFile(
      join(pluginRoot, "hooks", "hooks.json"),
      JSON.stringify({ hooks: spec.hookEvents }),
      "utf8",
    );
  }
  if (spec.hookScripts) {
    for (const [rel, source] of Object.entries(spec.hookScripts)) {
      const target = join(pluginRoot, rel);
      await fs.mkdir(join(target, ".."), { recursive: true });
      await fs.writeFile(target, source, "utf8");
    }
  }
  if (spec.skills?.length) {
    await fs.mkdir(join(pluginRoot, "skills"), { recursive: true });
    for (const s of spec.skills) {
      const lines = [`---`, `name: ${s.name}`];
      if (s.triggers?.length)
        lines.push(`triggers: ${s.triggers.join(", ")}`);
      lines.push("---", "body");
      await fs.writeFile(
        join(pluginRoot, "skills", `${s.name}.md`),
        lines.join("\n") + "\n",
        "utf8",
      );
    }
  }
  if (spec.agents?.length) {
    await fs.mkdir(join(pluginRoot, "agents"), { recursive: true });
    for (const a of spec.agents) {
      await fs.writeFile(
        join(pluginRoot, "agents", `${a}.md`),
        `---\nname: ${a}\n---\nbody\n`,
        "utf8",
      );
    }
  }
}
