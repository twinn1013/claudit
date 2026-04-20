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
});
