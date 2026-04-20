import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Snapshot } from "../../src/snapshot.js";
import { isolated, mkTmp, writeJson, writeText } from "./_helpers.js";

describe("capturePluginsFromMarketplaces", () => {
  it("captures marketplace root as plugin AND nested plugins under plugins/", async () => {
    const globalRoot = await mkTmp("market-root-");
    // Marketplace root with marketplace.json + hooks + nested plugins.
    const marketRoot = join(globalRoot, "plugins", "marketplaces", "omc");
    await writeJson(
      join(marketRoot, ".claude-plugin", "marketplace.json"),
      { name: "omc-marketplace", owner: { name: "omc" } },
    );
    await writeJson(join(marketRoot, "hooks", "hooks.json"), {
      hooks: {
        SessionStart: [
          {
            matcher: "startup|clear|compact",
            hooks: [{ type: "command", command: "node hooks/mp.mjs" }],
          },
        ],
      },
    });
    await writeText(join(marketRoot, "hooks", "mp.mjs"), "ok\n");

    // Nested plugin.
    const nestedRoot = join(marketRoot, "plugins", "inner-plugin");
    await writeJson(
      join(nestedRoot, ".claude-plugin", "plugin.json"),
      { name: "inner-plugin", version: "0.0.1" },
    );
    await writeJson(join(nestedRoot, "hooks", "hooks.json"), {
      hooks: {
        PreToolUse: [
          {
            matcher: "Bash",
            hooks: [{ type: "command", command: "node inner.mjs" }],
          },
        ],
      },
    });
    await writeText(join(nestedRoot, "inner.mjs"), "ok\n");

    const snap = new Snapshot({
      globalRoot,
      pathOverride: "",
      ...isolated(),
    });
    const data = await snap.capture();

    const names = data.plugins.map((p) => p.name).sort();
    expect(names).toContain("omc-marketplace");
    expect(names).toContain("inner-plugin");

    const root = data.plugins.find((p) => p.name === "omc-marketplace");
    expect(root?.source).toBe("plugin-marketplace");
    expect(root?.hookEvents.SessionStart[0].source).toBe("plugin-marketplace");

    const nested = data.plugins.find((p) => p.name === "inner-plugin");
    expect(nested?.source).toBe("plugin-marketplace");
    expect(nested?.hookEvents.PreToolUse[0].source).toBe("plugin-marketplace");
  });
});
