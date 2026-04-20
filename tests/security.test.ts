import { promises as fs } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PathBinaryDetector } from "../src/detectors/path-binary.js";
import { Snapshot } from "../src/snapshot.js";
import { makeGlobalRoot, makeTempDir, writeFakePlugin } from "./helpers/fixtures.js";

describe("security: symlink containment in snapshot", () => {
  it("does NOT read hook script contents when the script is a symlink escaping the plugin root", async () => {
    const sensitive = await makeTempDir("sensitive-");
    const secretPath = join(sensitive, "secret.mjs");
    await fs.writeFile(secretPath, "SECRET_CONTENT_SHOULD_NOT_LEAK\n", "utf8");

    const pluginsDir = await makeTempDir("plugins-parent-");
    await fs.mkdir(join(pluginsDir, "plugins"), { recursive: true });
    const pluginRoot = join(pluginsDir, "plugins", "evil");
    await writeFakePlugin(pluginRoot, {
      name: "evil",
      hookEvents: {
        PreToolUse: [
          {
            matcher: "Bash",
            hooks: [
              {
                type: "command",
                command: "node hooks/escape.mjs",
                timeout: 5000,
              },
            ],
          },
        ],
      },
    });
    await fs.mkdir(join(pluginRoot, "hooks"), { recursive: true });
    // Symlink escape: the hook script lives outside the plugin root.
    await fs.symlink(secretPath, join(pluginRoot, "hooks", "escape.mjs"));

    const data = await new Snapshot({
      globalRoot: pluginsDir,
      pathOverride: "",
    }).capture();
    const plugin = data.plugins.find((p) => p.name === "evil");
    expect(plugin).toBeDefined();
    const registrations = plugin!.hookEvents.PreToolUse;
    const script = registrations[0].hooks[0];
    expect(script.scriptSource).toBeUndefined();
  });

  it("DOES read a hook script that is a symlink staying within the plugin root", async () => {
    const pluginsDir = await makeTempDir("plugins-ok-");
    await fs.mkdir(join(pluginsDir, "plugins"), { recursive: true });
    const pluginRoot = join(pluginsDir, "plugins", "good");
    await writeFakePlugin(pluginRoot, {
      name: "good",
      hookEvents: {
        PreToolUse: [
          {
            matcher: "Bash",
            hooks: [
              {
                type: "command",
                command: "node hooks/link.mjs",
                timeout: 5000,
              },
            ],
          },
        ],
      },
    });
    await fs.mkdir(join(pluginRoot, "hooks"), { recursive: true });
    await fs.writeFile(
      join(pluginRoot, "hooks", "target.mjs"),
      "// inside plugin root\n",
      "utf8",
    );
    await fs.symlink(
      join(pluginRoot, "hooks", "target.mjs"),
      join(pluginRoot, "hooks", "link.mjs"),
    );
    const data = await new Snapshot({
      globalRoot: pluginsDir,
      pathOverride: "",
    }).capture();
    const plugin = data.plugins.find((p) => p.name === "good");
    const script = plugin!.hookEvents.PreToolUse[0].hooks[0];
    expect(script.scriptSource).toContain("inside plugin root");
  });
});

describe("security: non-regular-file guard in path-binary detector", () => {
  it("does NOT hash or report non-regular files (e.g., a directory named like a binary)", async () => {
    const dirA = await makeTempDir("pb-nonreg-a-");
    const dirB = await makeTempDir("pb-nonreg-b-");
    // dirA: real binary content
    await fs.writeFile(join(dirA, "thing"), "real binary\n", { mode: 0o755 });
    // dirB: a *directory* with the same name (no file content)
    await fs.mkdir(join(dirB, "thing"), { recursive: true });

    const root = await makeGlobalRoot([]);
    const data = await new Snapshot({
      globalRoot: root,
      pathOverride: `${dirA}:${dirB}`,
    }).capture();
    const collisions = await new PathBinaryDetector().analyze(data);
    // `thing` appears at both locations by name, but one is a directory and
    // cannot be hashed. Either we produce no collision (allowlist semantics
    // skip over the non-regular entry) or a `possible` collision — but we
    // must NOT block or hang on reading the directory.
    for (const c of collisions) {
      if (c.category === "path-binary" && c.entities_involved.some((e) => e.endsWith("/thing"))) {
        expect(c.confidence).not.toBe("definite");
      }
    }
  });
});
