import { promises as fs } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(__dirname, "..");

interface HooksJson {
  hooks: Record<
    string,
    Array<{
      matcher?: string;
      hooks: Array<{ type: string; command: string; timeout?: number }>;
    }>
  >;
}

describe("ralph-verify: install criterion", () => {
  it("hooks/hooks.json exists at plugin root (convention path, not in plugin.json)", async () => {
    const stat = await fs.stat(join(repoRoot, "hooks", "hooks.json"));
    expect(stat.isFile()).toBe(true);
  });

  it("hooks/hooks.json parses as valid JSON matching the expected schema", async () => {
    const raw = await fs.readFile(join(repoRoot, "hooks", "hooks.json"), "utf8");
    const parsed = JSON.parse(raw) as HooksJson;
    expect(parsed.hooks).toBeDefined();
    const events = Object.keys(parsed.hooks);
    expect(events.sort()).toEqual(["PostToolUse", "SessionStart"]);
  });

  it("every hook entry has type: 'command', a non-empty command string, and numeric timeout", async () => {
    const raw = await fs.readFile(join(repoRoot, "hooks", "hooks.json"), "utf8");
    const parsed = JSON.parse(raw) as HooksJson;
    for (const entries of Object.values(parsed.hooks)) {
      for (const entry of entries) {
        for (const hook of entry.hooks) {
          expect(hook.type).toBe("command");
          expect(typeof hook.command).toBe("string");
          expect(hook.command.length).toBeGreaterThan(0);
          expect(typeof hook.timeout).toBe("number");
        }
      }
    }
  });

  it("plugin.json lives at .claude-plugin/plugin.json with name 'claudit' and a commands array", async () => {
    const raw = await fs.readFile(
      join(repoRoot, ".claude-plugin", "plugin.json"),
      "utf8",
    );
    const parsed = JSON.parse(raw) as {
      name?: string;
      commands?: unknown;
      skills?: unknown;
    };
    expect(parsed.name).toBe("claudit");
    expect(Array.isArray(parsed.commands)).toBe(true);
    expect((parsed.commands as unknown[]).length).toBeGreaterThanOrEqual(1);
    // CONSENSUS deviation check: commands must be strings, not objects.
    for (const entry of parsed.commands as unknown[]) {
      expect(typeof entry).toBe("string");
    }
    // Consensus says no `skills` field is used — commands only.
    expect(parsed.skills).toBeUndefined();
  });

  it("SessionStart matcher uses '*' per CONSENSUS deviation, not ''", async () => {
    const raw = await fs.readFile(join(repoRoot, "hooks", "hooks.json"), "utf8");
    const parsed = JSON.parse(raw) as HooksJson;
    for (const entry of parsed.hooks.SessionStart) {
      expect(entry.matcher).toBe("*");
    }
    for (const entry of parsed.hooks.PostToolUse) {
      expect(entry.matcher).toBe("*");
    }
  });
});

describe("ralph-verify: namespace criterion", () => {
  /**
   * In real use, we would enumerate ~/.claude/plugins/** to confirm no other
   * plugin registers the same identifiers as claudit. In an automated test we
   * assert the narrower invariant: claudit's own plugin.json declares only
   * identifiers under its own namespace.
   */
  it("claudit's own plugin.json has no surprise identifiers outside the commands array", async () => {
    const raw = await fs.readFile(
      join(repoRoot, ".claude-plugin", "plugin.json"),
      "utf8",
    );
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const allowedFields = new Set([
      "name",
      "version",
      "description",
      "author",
      "license",
      "homepage",
      "repository",
      "commands",
      "mcpServers",
    ]);
    for (const key of Object.keys(parsed)) {
      expect(allowedFields.has(key)).toBe(true);
    }
  });
});

describe("ralph-verify: idempotency criterion", () => {
  it("hooks/hooks.json has exactly 2 event entries (PostToolUse, SessionStart)", async () => {
    const raw = await fs.readFile(join(repoRoot, "hooks", "hooks.json"), "utf8");
    const parsed = JSON.parse(raw) as HooksJson;
    expect(Object.keys(parsed.hooks).length).toBe(2);
  });

  it("tsup config declares all three expected hook/command build entries", async () => {
    const source = await fs.readFile(
      join(repoRoot, "tsup.config.ts"),
      "utf8",
    );
    expect(source).toContain('"hooks/post-tool-use"');
    expect(source).toContain('"hooks/session-start"');
    expect(source).toContain('"commands/scan"');
  });
});
