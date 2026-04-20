import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Snapshot } from "../../src/snapshot.js";
import { mkTmp, writeJson } from "./_helpers.js";

describe("Delta 1 — ~/.claude.json MCP probe", () => {
  it("merges mcpServers from the home MCP config into settingsMcpServers", async () => {
    const tmpRoot = await mkTmp("delta1-");
    const globalRoot = join(tmpRoot, ".claude");
    await writeJson(join(globalRoot, "settings.json"), {});
    const homePath = join(tmpRoot, ".claude.json");
    await writeJson(homePath, {
      mcpServers: {
        search: { tools: ["web"] },
      },
    });

    const snap = new Snapshot({
      globalRoot,
      pathOverride: "",
      homeMcpConfigPath: homePath,
      managedSettingsPath: null,
    });
    const data = await snap.capture();
    expect(data.settingsMcpServers.map((m) => m.name)).toEqual(["search"]);
  });

  it("capture() proceeds silently when ~/.claude.json is absent", async () => {
    const globalRoot = await mkTmp("delta1-absent-");
    const snap = new Snapshot({
      globalRoot,
      pathOverride: "",
      homeMcpConfigPath: "/nonexistent/claudit-no-home.json",
      managedSettingsPath: null,
    });
    const data = await snap.capture();
    expect(data.settingsMcpServers).toEqual([]);
  });
});
