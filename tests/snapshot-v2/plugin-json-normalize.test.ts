import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Snapshot } from "../../src/snapshot.js";
import { isolated, mkTmp, writeJson, writeText } from "./_helpers.js";

describe("plugin.json field normalization", () => {
  it("skills as string dir path walks the directory", async () => {
    const globalRoot = await mkTmp("skills-string-dir-");
    const pRoot = join(globalRoot, "plugins", "omc");
    await writeJson(join(pRoot, ".claude-plugin", "plugin.json"), {
      name: "omc",
      skills: "./skills/",
    });
    await writeText(
      join(pRoot, "skills", "deep-dive", "SKILL.md"),
      "---\nname: deep-dive\n---\nbody\n",
    );
    await writeText(
      join(pRoot, "skills", "plain.md"),
      "---\nname: plain\n---\nbody\n",
    );

    const snap = new Snapshot({
      globalRoot,
      pathOverride: "",
      ...isolated(),
    });
    const data = await snap.capture();
    const p = data.plugins.find((pp) => pp.name === "omc");
    expect(p).toBeDefined();
    const names = p!.skills.map((s) => s.name).sort();
    expect(names).toEqual(["deep-dive", "plain"]);
  });

  it("skills as array of string paths uses each entry", async () => {
    const globalRoot = await mkTmp("skills-array-");
    const pRoot = join(globalRoot, "plugins", "karpathy-skills");
    await writeJson(join(pRoot, ".claude-plugin", "plugin.json"), {
      name: "karpathy-skills",
      skills: ["./skills/foo"],
    });
    await writeText(
      join(pRoot, "skills", "foo", "SKILL.md"),
      "---\nname: foo\n---\nbody\n",
    );

    const snap = new Snapshot({
      globalRoot,
      pathOverride: "",
      ...isolated(),
    });
    const data = await snap.capture();
    const p = data.plugins.find((pp) => pp.name === "karpathy-skills");
    expect(p?.skills.map((s) => s.name)).toEqual(["foo"]);
  });

  it("skills as string path to a single SKILL.md captures one skill", async () => {
    const globalRoot = await mkTmp("skills-single-");
    const pRoot = join(globalRoot, "plugins", "solo");
    await writeJson(join(pRoot, ".claude-plugin", "plugin.json"), {
      name: "solo",
      skills: "./skills/foo/SKILL.md",
    });
    await writeText(
      join(pRoot, "skills", "foo", "SKILL.md"),
      "---\nname: foo-skill\n---\nbody\n",
    );

    const snap = new Snapshot({
      globalRoot,
      pathOverride: "",
      ...isolated(),
    });
    const data = await snap.capture();
    const p = data.plugins.find((pp) => pp.name === "solo");
    expect(p?.skills.map((s) => s.name)).toEqual(["foo-skill"]);
  });

  it("mcpServers as string path reads the referenced .mcp.json", async () => {
    const globalRoot = await mkTmp("mcp-string-");
    const pRoot = join(globalRoot, "plugins", "omc-mcp");
    await writeJson(join(pRoot, ".claude-plugin", "plugin.json"), {
      name: "omc-mcp",
      mcpServers: "./.mcp.json",
    });
    await writeJson(join(pRoot, ".mcp.json"), {
      mcpServers: {
        search: { tools: ["web"] },
        context: { tools: ["doc"] },
      },
    });

    const snap = new Snapshot({
      globalRoot,
      pathOverride: "",
      ...isolated(),
    });
    const data = await snap.capture();
    const p = data.plugins.find((pp) => pp.name === "omc-mcp");
    expect(p?.mcpServers.map((m) => m.name).sort()).toEqual([
      "context",
      "search",
    ]);
    expect(p?.mcpServers.every((m) => m.source === "plugin")).toBe(true);
  });
});
