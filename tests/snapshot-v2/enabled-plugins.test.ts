import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Snapshot } from "../../src/snapshot.js";
import { isolated, mkTmp, writeJson } from "./_helpers.js";

describe("applyEnabledPluginsFilter", () => {
  it("applies enabledPlugins map: false -> enabled:false; absent -> default true", async () => {
    const globalRoot = await mkTmp("enabled-");
    // Three plugins under legacy `plugins/` layout.
    for (const name of ["foo", "bar", "baz"]) {
      await writeJson(
        join(globalRoot, "plugins", name, ".claude-plugin", "plugin.json"),
        { name },
      );
    }
    await writeJson(join(globalRoot, "settings.json"), {
      enabledPlugins: {
        foo: false,
        bar: true,
      },
    });

    const snap = new Snapshot({
      globalRoot,
      pathOverride: "",
      ...isolated(),
    });
    const data = await snap.capture();

    const by = new Map(data.plugins.map((p) => [p.name, p]));
    expect(by.get("foo")?.enabled).toBe(false);
    expect(by.get("bar")?.enabled).toBe(true);
    // Conservative default: absent in map means enabled.
    expect(by.get("baz")?.enabled).toBe(true);
  });

  it("accepts namespaced enabledPlugins keys like plugin@marketplace", async () => {
    const globalRoot = await mkTmp("enabled-namespaced-");
    await writeJson(
      join(
        globalRoot,
        "plugins",
        "cache",
        "omc",
        "oh-my-claudecode",
        "4.11.6",
        ".claude-plugin",
        "plugin.json",
      ),
      { name: "oh-my-claudecode", version: "4.11.6" },
    );
    await writeJson(join(globalRoot, "settings.json"), {
      enabledPlugins: {
        "oh-my-claudecode@omc": false,
      },
    });

    const snap = new Snapshot({
      globalRoot,
      pathOverride: "",
      ...isolated(),
    });
    const data = await snap.capture();

    expect(data.plugins).toHaveLength(1);
    expect(data.plugins[0]?.enabled).toBe(false);
  });
});
