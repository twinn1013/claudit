/**
 * hook-matcher-v2.test.ts — multi-source + new semantics tests for Stage 2.
 *
 * These tests construct SnapshotData directly (no file-system fixtures) so
 * they run fast and in complete isolation from the Snapshot capture layer.
 */
import { describe, expect, it } from "vitest";
import {
  HookMatcherDetector,
  classifyHookScript,
} from "../../src/detectors/hook-matcher.js";
import type { HookScript, SnapshotData } from "../../src/types.js";

// ---------------------------------------------------------------------------
// Minimal SnapshotData builder
// ---------------------------------------------------------------------------

function emptySnapshot(overrides: Partial<SnapshotData> = {}): SnapshotData {
  return {
    globalRoot: "/fake",
    projectRoot: undefined,
    plugins: [],
    settingsMcpServers: [],
    projectMcpServers: [],
    settingsHooks: [],
    pathBinaries: {},
    capturedAt: new Date().toISOString(),
    fingerprint: "test",
    ...overrides,
  };
}

function mutatingScript(extra?: Partial<HookScript>): HookScript {
  return {
    command: "node mutator.mjs",
    kind: "command",
    scriptSource: "updatedInput.command = 'rewritten';",
    ...extra,
  };
}

function readonlyScript(extra?: Partial<HookScript>): HookScript {
  return {
    command: "node readonly.mjs",
    kind: "command",
    scriptSource: 'console.log("no mutation");',
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// EC1: rtk (user-settings, "*") + OMC plugin ("*") both mutating → definite
// ---------------------------------------------------------------------------

describe("EC1 — cross-source * / * both mutating", () => {
  it("produces definite critical collision with both entities_involved", async () => {
    const snap = emptySnapshot({
      // plugin-sourced hook (OMC): PreToolUse / "*"
      plugins: [
        {
          name: "omc-plugin",
          pluginRoot: "/fake/plugins/omc-plugin",
          source: "plugin-cache",
          enabled: true,
          hookEvents: {
            PreToolUse: [
              {
                matcher: "*",
                source: "plugin-cache",
                hooks: [mutatingScript()],
              },
            ],
          },
          commands: [],
          skills: [],
          agents: [],
          mcpServers: [],
        },
      ],
      // settings-sourced hook (rtk): PreToolUse / "*"
      settingsHooks: [
        {
          event: "PreToolUse",
          matcher: "*",
          source: "user-settings",
          hooks: [mutatingScript({ command: "rtk-hook" })],
        },
      ],
    });

    const collisions = await new HookMatcherDetector().analyze(snap);
    expect(collisions).toHaveLength(1);
    expect(collisions[0].confidence).toBe("definite");
    expect(collisions[0].severity).toBe("critical");

    const entities = collisions[0].entities_involved;
    expect(entities.some((e) => e.includes("user-settings:PreToolUse:*"))).toBe(
      true,
    );
    expect(entities.some((e) => e.includes("omc-plugin:PreToolUse:*"))).toBe(
      true,
    );
  });
});

describe("EC1c — same plugin name across marketplaces stays distinct in hook entities", () => {
  it("uses marketplace-qualified plugin identities for hook entities", async () => {
    const snap = emptySnapshot({
      plugins: [
        {
          name: "foo",
          marketplace: "alpha",
          pluginRoot: "/plugins/cache/alpha/foo/1.0.0",
          source: "plugin-cache",
          enabled: false,
          hookEvents: {
            PreToolUse: [
              {
                matcher: "*",
                source: "plugin-cache",
                hooks: [mutatingScript({ command: "hook-alpha" })],
              },
            ],
          },
          commands: [],
          skills: [],
          agents: [],
          mcpServers: [],
        },
        {
          name: "foo",
          marketplace: "beta",
          pluginRoot: "/plugins/cache/beta/foo/1.0.0",
          source: "plugin-cache",
          enabled: true,
          hookEvents: {
            PreToolUse: [
              {
                matcher: "*",
                source: "plugin-cache",
                hooks: [mutatingScript({ command: "hook-beta" })],
              },
            ],
          },
          commands: [],
          skills: [],
          agents: [],
          mcpServers: [],
        },
      ],
    });

    const collisions = await new HookMatcherDetector().analyze(snap);
    expect(collisions.some((c) => c.entities_involved.includes("foo@alpha:PreToolUse:*"))).toBe(true);
    expect(collisions.some((c) => c.entities_involved.includes("foo@beta:PreToolUse:*"))).toBe(true);
  });
});

describe("EC1b — RTK command is treated as a known mutating hook", () => {
  it("classifies `rtk hook claude` as mutating without local script source", () => {
    const script: HookScript = {
      command: "rtk hook claude",
      kind: "command",
    };
    expect(classifyHookScript(script)).toBe("mutates");
  });
});

// ---------------------------------------------------------------------------
// EC2: Edit|Write vs Edit both mutating → collision
// ---------------------------------------------------------------------------

describe("EC2 — Edit|Write vs Edit both mutating", () => {
  it("produces a collision when matchers overlap", async () => {
    const snap = emptySnapshot({
      settingsHooks: [
        {
          event: "PreToolUse",
          matcher: "Edit|Write",
          source: "user-settings",
          hooks: [mutatingScript({ command: "hook-a" })],
        },
        {
          event: "PreToolUse",
          matcher: "Edit",
          source: "project-settings",
          hooks: [mutatingScript({ command: "hook-b" })],
        },
      ],
    });

    const collisions = await new HookMatcherDetector().analyze(snap);
    expect(collisions).toHaveLength(1);
    expect(collisions[0].confidence).toBe("definite");
  });
});

// ---------------------------------------------------------------------------
// EC3: Bash vs Read → no collision (disjoint)
// ---------------------------------------------------------------------------

describe("EC3 — Bash vs Read (disjoint matchers)", () => {
  it("produces no collision", async () => {
    const snap = emptySnapshot({
      settingsHooks: [
        {
          event: "PreToolUse",
          matcher: "Bash",
          source: "user-settings",
          hooks: [mutatingScript({ command: "hook-bash" })],
        },
        {
          event: "PreToolUse",
          matcher: "Read",
          source: "user-settings",
          hooks: [mutatingScript({ command: "hook-read" })],
        },
      ],
    });

    const collisions = await new HookMatcherDetector().analyze(snap);
    expect(collisions).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// EC4: standalone JSON.stringify(updatedInput) → readonly → no collision alone
// ---------------------------------------------------------------------------

describe("EC4 — standalone JSON.stringify(updatedInput) → readonly", () => {
  it("classifies as readonly (v0.2 gap #10 — standalone JSON.stringify is read-only serialization)", () => {
    const script: HookScript = {
      command: "node serialiser.mjs",
      kind: "command",
      // Only reference to updatedInput is inside JSON.stringify — no mutation.
      scriptSource:
        'const out = JSON.stringify(updatedInput);\nconsole.log(out);',
    };
    expect(classifyHookScript(script)).toBe("readonly");
  });

  it("readonly + mutating hook on same event+matcher → no collision (need 2 mutates or 1+unknown)", async () => {
    const snap = emptySnapshot({
      settingsHooks: [
        {
          event: "PreToolUse",
          matcher: "*",
          source: "user-settings",
          hooks: [
            // readonly serialiser
            {
              command: "node serialiser.mjs",
              kind: "command",
              scriptSource:
                'const out = JSON.stringify(updatedInput);\nconsole.log(out);',
            },
            // actual mutator
            mutatingScript({ command: "node mutator.mjs" }),
          ],
        },
      ],
    });

    // 1 mutate + 1 readonly → threshold not met → no collision.
    const collisions = await new HookMatcherDetector().analyze(snap);
    expect(collisions).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// EC5: updatedInput.command = ... in two hooks → definite
// ---------------------------------------------------------------------------

describe("EC5 — two explicit updatedInput.command assignments → definite", () => {
  it("produces definite collision", async () => {
    const snap = emptySnapshot({
      settingsHooks: [
        {
          event: "PreToolUse",
          matcher: "Bash",
          source: "user-settings",
          hooks: [
            mutatingScript({ command: "hook-a", scriptSource: "updatedInput.command = 'A';" }),
            mutatingScript({ command: "hook-b", scriptSource: "updatedInput.command = 'B';" }),
          ],
        },
      ],
    });

    const collisions = await new HookMatcherDetector().analyze(snap);
    expect(collisions).toHaveLength(1);
    expect(collisions[0].confidence).toBe("definite");
    expect(collisions[0].severity).toBe("critical");
  });
});

// ---------------------------------------------------------------------------
// EC6 / C4: user-settings "*" + plugin "Bash" both mutating → definite
// Both entities_involved must contain the right entity strings.
// ---------------------------------------------------------------------------

describe("C4 — cross-source * (user-settings) + Bash (plugin) both mutating", () => {
  it("produces definite collision; entities_involved includes both source strings", async () => {
    const snap = emptySnapshot({
      plugins: [
        {
          name: "test-plugin",
          pluginRoot: "/fake/plugins/test-plugin",
          source: "plugin-cache",
          enabled: true,
          hookEvents: {
            PreToolUse: [
              {
                matcher: "Bash",
                source: "plugin-cache",
                hooks: [mutatingScript()],
              },
            ],
          },
          commands: [],
          skills: [],
          agents: [],
          mcpServers: [],
        },
      ],
      settingsHooks: [
        {
          event: "PreToolUse",
          matcher: "*",
          source: "user-settings",
          hooks: [mutatingScript({ command: "settings-hook" })],
        },
      ],
    });

    const collisions = await new HookMatcherDetector().analyze(snap);
    expect(collisions).toHaveLength(1);
    expect(collisions[0].confidence).toBe("definite");
    expect(collisions[0].severity).toBe("critical");

    const entities = collisions[0].entities_involved;
    expect(
      entities.some((e) => e.includes("user-settings:PreToolUse:*")),
    ).toBe(true);
    expect(
      entities.some((e) => e.includes("test-plugin:PreToolUse:Bash")),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Delta 2c: non-command kind → unknown → possible when paired with mutating
// ---------------------------------------------------------------------------

describe("Delta 2c — non-command HookScript.kind treated as unknown", () => {
  it("prompt kind classified as unknown", () => {
    const script: HookScript = {
      command: "",
      kind: "prompt",
      scriptSource: "some content",
    };
    expect(classifyHookScript(script)).toBe("unknown");
  });

  it("http kind classified as unknown", () => {
    const script: HookScript = {
      command: "",
      kind: "http",
      scriptSource: "updatedInput.command = 'x';",
    };
    // Even if source looks mutating, kind != command → unknown.
    expect(classifyHookScript(script)).toBe("unknown");
  });

  it("prompt hook paired with mutating plugin hook → possible collision (not silently dropped)", async () => {
    const snap = emptySnapshot({
      plugins: [
        {
          name: "mutator-plugin",
          pluginRoot: "/fake/plugins/mutator-plugin",
          source: "plugin-cache",
          enabled: true,
          hookEvents: {
            PreToolUse: [
              {
                matcher: "*",
                source: "plugin-cache",
                hooks: [mutatingScript()],
              },
            ],
          },
          commands: [],
          skills: [],
          agents: [],
          mcpServers: [],
        },
      ],
      settingsHooks: [
        {
          event: "PreToolUse",
          matcher: "*",
          source: "user-settings",
          hooks: [
            {
              command: "",
              kind: "prompt",
              scriptSource: "Review this edit.",
              rawConfig: { type: "prompt", prompt: "Review this edit." },
            },
          ],
        },
      ],
    });

    const collisions = await new HookMatcherDetector().analyze(snap);
    expect(collisions).toHaveLength(1);
    // 1 mutates + 1 unknown → possible
    expect(collisions[0].confidence).toBe("possible");
  });
});
