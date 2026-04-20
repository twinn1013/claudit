import { promises as fs } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { main as sessionStart } from "../../src/hooks/session-start.js";
import { Scanner } from "../../src/scanner.js";
import { Snapshot } from "../../src/snapshot.js";
import { writePendingMarker, listPendingMarkers } from "../../src/pending.js";
import { makeGlobalRoot, makeTempDir } from "../helpers/fixtures.js";

interface StdoutCapture {
  lines: string[];
  restore: () => void;
}

function captureStdout(): StdoutCapture {
  const orig = process.stdout.write.bind(process.stdout);
  const lines: string[] = [];
  (process.stdout.write as unknown as (chunk: unknown) => boolean) = (
    chunk: unknown,
  ): boolean => {
    lines.push(String(chunk));
    return true;
  };
  return {
    lines,
    restore: () => {
      (process.stdout.write as unknown as typeof orig) = orig;
    },
  };
}

function parseOutput(cap: StdoutCapture): {
  continue: boolean;
  hookSpecificOutput?: { additionalContext?: string };
} {
  return JSON.parse(cap.lines.join("").trim());
}

describe("SessionStart hook", () => {
  let cap: StdoutCapture;
  beforeEach(() => {
    cap = captureStdout();
  });
  afterEach(() => cap.restore());

  it("runs the scanner and injects a report when pending markers are present", async () => {
    const globalRoot = await makeGlobalRoot([
      { name: "plugin-a", commands: ["scan.md"] },
      { name: "plugin-b", commands: ["scan.md"] },   // duplicate /scan
    ]);
    const storageRoot = await makeTempDir("store-");
    const pendingDir = await makeTempDir("pending-");
    await writePendingMarker({
      dir: pendingDir,
      marker: {
        timestamp: "2026-04-20T12:00:00.000Z",
        trigger: "PostToolUse",
        command: "brew install ripgrep",
        matched_pattern: "brew install",
      },
    });

    await sessionStart({
      stdin: "{}",
      globalRoot,
      storageRoot,
      pendingDir,
      pathOverride: "",
    });

    const out = parseOutput(cap);
    expect(out.continue).toBe(true);
    expect(out.hookSpecificOutput?.additionalContext).toContain(
      "<claudit-report>",
    );
    expect(out.hookSpecificOutput?.additionalContext).toContain("slash-command");
    const remaining = await listPendingMarkers({ dir: pendingDir });
    expect(remaining).toEqual([]);
  });

  it("runs the scanner when snapshot diff shows changes (no pending markers)", async () => {
    const prevRoot = await makeGlobalRoot([
      { name: "plugin-a", commands: ["scan.md"] },
    ]);
    const currRoot = await makeGlobalRoot([
      { name: "plugin-a", commands: ["scan.md"] },
      { name: "plugin-b", commands: ["scan.md"] },   // new plugin — collision
    ]);
    const storageRoot = await makeTempDir("store-");
    const pendingDir = await makeTempDir("pending-");

    await new Snapshot({
      globalRoot: prevRoot,
      pathOverride: "",
      storageRoot,
    })
      .capture()
      .then((data) => {
        const snap = new Snapshot({
          globalRoot: prevRoot,
          pathOverride: "",
          storageRoot,
        });
        (snap as unknown as { _data: typeof data })._data = data;
        return snap.save();
      });

    await sessionStart({
      stdin: "{}",
      globalRoot: currRoot,
      storageRoot,
      pendingDir,
      pathOverride: "",
    });

    const out = parseOutput(cap);
    expect(out.continue).toBe(true);
    expect(out.hookSpecificOutput?.additionalContext).toContain(
      "<claudit-report>",
    );
  });

  it("outputs a silent continue when no pending markers and no diff (and previous snapshot exists)", async () => {
    const root = await makeGlobalRoot([{ name: "plugin-a", commands: ["scan.md"] }]);
    const storageRoot = await makeTempDir("store-");
    const pendingDir = await makeTempDir("pending-");

    // pre-seed a snapshot identical to what we're about to capture
    const seed = new Snapshot({
      globalRoot: root,
      pathOverride: "",
      storageRoot,
    });
    await seed.capture();
    await seed.save();

    const start = Date.now();
    await sessionStart({
      stdin: "{}",
      globalRoot: root,
      storageRoot,
      pendingDir,
      pathOverride: "",
    });
    const elapsed = Date.now() - start;

    const out = parseOutput(cap);
    expect(out.continue).toBe(true);
    expect(out.hookSpecificOutput).toBeUndefined();
    // Allow some slack for filesystem latency on CI; spec target is 50ms.
    expect(elapsed).toBeLessThan(300);
  });

  it("preserves pending markers when the scan itself throws", async () => {
    const globalRoot = await makeGlobalRoot([{ name: "plugin-a" }]);
    const storageRoot = await makeTempDir("store-");
    const pendingDir = await makeTempDir("pending-");
    await writePendingMarker({
      dir: pendingDir,
      marker: {
        timestamp: "2026-04-20T12:00:00.000Z",
        trigger: "PostToolUse",
        command: "brew install foo",
        matched_pattern: "brew install",
      },
    });
    // Scanner that throws from run() (rare, but we must preserve markers).
    const broken: Scanner = {
      // Pretend to be a Scanner for the factory contract.
      async run() {
        throw new Error("scanner kaboom");
      },
    } as unknown as Scanner;

    await sessionStart({
      stdin: "{}",
      globalRoot,
      storageRoot,
      pendingDir,
      pathOverride: "",
      scannerFactory: () => broken,
    });

    const out = parseOutput(cap);
    expect(out.continue).toBe(true);
    // Marker NOT deleted because the scan failed.
    const remaining = await listPendingMarkers({ dir: pendingDir });
    expect(remaining).toHaveLength(1);
  });

  it("completes within 500ms for a fixture with 5 installed plugins", async () => {
    const plugins = Array.from({ length: 5 }, (_, i) => ({
      name: `p${i}`,
      commands: [`cmd-${i}.md`],
    }));
    const globalRoot = await makeGlobalRoot(plugins);
    const storageRoot = await makeTempDir("store-");
    const pendingDir = await makeTempDir("pending-");

    const start = Date.now();
    await sessionStart({
      stdin: "{}",
      globalRoot,
      storageRoot,
      pendingDir,
      pathOverride: "",
    });
    const elapsed = Date.now() - start;

    const out = parseOutput(cap);
    expect(out.continue).toBe(true);
    expect(elapsed).toBeLessThan(500);
  });
});
