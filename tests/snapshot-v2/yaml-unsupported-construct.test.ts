import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Snapshot } from "../../src/snapshot.js";
import { isolated, mkTmp, writeJson, writeText } from "./_helpers.js";

describe("YAML unsupported construct surfaces parseWarnings (R2)", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("flow mapping in a SKILL.md frontmatter yields parseWarnings on the skill", async () => {
    const globalRoot = await mkTmp("yaml-bad-");
    const pRoot = join(globalRoot, "plugins", "broken");
    await writeJson(join(pRoot, ".claude-plugin", "plugin.json"), {
      name: "broken",
    });
    const skillMd = [
      "---",
      "name: bad-skill",
      "triggers: {a: 1, b: 2}",
      "---",
      "body",
      "",
    ].join("\n");
    await writeText(
      join(pRoot, "skills", "bad-skill", "SKILL.md"),
      skillMd,
    );

    const snap = new Snapshot({
      globalRoot,
      pathOverride: "",
      ...isolated(),
    });
    const data = await snap.capture();
    const p = data.plugins.find((pp) => pp.name === "broken");
    expect(p?.skills).toHaveLength(1);
    const skill = p!.skills[0];
    expect(skill.parseWarnings).toBeDefined();
    expect(skill.parseWarnings!.length).toBeGreaterThan(0);
    expect(skill.parseWarnings!.join(" ")).toMatch(/flow mapping/i);
    // stderr write happened.
    expect(warnSpy).toHaveBeenCalled();
  });

  it("folded multiline > in agent frontmatter also surfaces parseWarnings", async () => {
    const globalRoot = await mkTmp("yaml-agent-bad-");
    const pRoot = join(globalRoot, "plugins", "agent-broken");
    await writeJson(join(pRoot, ".claude-plugin", "plugin.json"), {
      name: "agent-broken",
    });
    const agentMd = [
      "---",
      "name: reviewer",
      "description: >",
      "  multi",
      "  line",
      "---",
      "body",
      "",
    ].join("\n");
    await writeText(join(pRoot, "agents", "reviewer.md"), agentMd);

    const snap = new Snapshot({
      globalRoot,
      pathOverride: "",
      ...isolated(),
    });
    const data = await snap.capture();
    const p = data.plugins.find((pp) => pp.name === "agent-broken");
    const agent = p?.agents.find((a) => a.name === "reviewer");
    expect(agent).toBeDefined();
    expect(agent!.parseWarnings).toBeDefined();
    expect(agent!.parseWarnings!.length).toBeGreaterThan(0);
  });
});
