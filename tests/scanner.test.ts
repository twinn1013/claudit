import { describe, expect, it } from "vitest";
import type { Detector } from "../src/detector.js";
import { DetectorTimeoutError, Scanner } from "../src/scanner.js";
import type { Collision, CollisionCategory, SnapshotData } from "../src/types.js";

const emptySnapshot: SnapshotData = {
  globalRoot: "/tmp/noop",
  plugins: [],
  settingsMcpServers: [],
  projectMcpServers: [],
  settingsHooks: [],
  pathBinaries: {},
  capturedAt: "2026-04-20T00:00:00.000Z",
  fingerprint: "empty",
};

function stubDetector(
  category: CollisionCategory,
  behaviour: {
    collisions?: Collision[];
    delayMs?: number;
    throws?: unknown;
  },
): Detector {
  return {
    category,
    async analyze(): Promise<Collision[]> {
      if (behaviour.delayMs) {
        await new Promise((r) => setTimeout(r, behaviour.delayMs));
      }
      if (behaviour.throws) throw behaviour.throws;
      return behaviour.collisions ?? [];
    },
  };
}

function collision(
  category: CollisionCategory,
  message: string,
  confidence: Collision["confidence"] = "definite",
): Collision {
  return {
    category,
    severity: "warning",
    confidence,
    entities_involved: [`${category}:${message}`],
    suggested_fix: [],
    message,
  };
}

describe("Scanner.run", () => {
  it("aggregates collisions from 6 detectors (3 with results, 2 empty, 1 throws)", async () => {
    const c1 = collision("slash-command", "dup-scan");
    const c2 = collision("skill-name", "dup-deploy");
    const c3 = collision("mcp-identifier", "dup-github");
    const detectors: Detector[] = [
      stubDetector("slash-command", { collisions: [c1] }),
      stubDetector("skill-name", { collisions: [c2] }),
      stubDetector("mcp-identifier", { collisions: [c3] }),
      stubDetector("subagent-type", { collisions: [] }),
      stubDetector("path-binary", { collisions: [] }),
      stubDetector("hook-matcher", { throws: new Error("boom") }),
    ];
    const report = await new Scanner({ detectors, detectorTimeoutMs: 200 }).run(
      emptySnapshot,
    );
    const categoriesPresent = new Set(report.collisions.map((c) => c.category));
    expect(categoriesPresent.has("slash-command")).toBe(true);
    expect(categoriesPresent.has("skill-name")).toBe(true);
    expect(categoriesPresent.has("mcp-identifier")).toBe(true);
    expect(categoriesPresent.has("internal-error")).toBe(true);
    const internalError = report.collisions.find(
      (c) => c.category === "internal-error",
    )!;
    expect(internalError.confidence).toBe("unknown");
    expect(internalError.entities_involved).toEqual(["hook-matcher"]);
    expect(internalError.message).toContain("boom");
    expect(report.metadata.error_count).toBe(1);
    expect(report.metadata.detector_count).toBe(6);
  });

  it("produces an internal-error with confidence 'unknown' when a detector exceeds the timeout", async () => {
    const slow = stubDetector("path-binary", { delayMs: 200 });
    const report = await new Scanner({
      detectors: [slow],
      detectorTimeoutMs: 50,
    }).run(emptySnapshot);
    expect(report.collisions).toHaveLength(1);
    expect(report.collisions[0].category).toBe("internal-error");
    expect(report.collisions[0].confidence).toBe("unknown");
    expect(report.collisions[0].message).toMatch(/timeout|timed out|exceeded/i);
  });

  it("completes within 150ms when all detectors respond within 100ms", async () => {
    const detectors: Detector[] = Array.from({ length: 6 }, (_, i) =>
      stubDetector(
        [
          "slash-command",
          "skill-name",
          "subagent-type",
          "mcp-identifier",
          "path-binary",
          "hook-matcher",
        ][i] as CollisionCategory,
        { delayMs: 30 },
      ),
    );
    const before = Date.now();
    const report = await new Scanner({
      detectors,
      detectorTimeoutMs: 100,
    }).run(emptySnapshot);
    const elapsed = Date.now() - before;
    expect(elapsed).toBeLessThan(150);
    expect(report.metadata.scan_duration_ms).toBeLessThan(150);
  });

  it("metadata contains timestamp, scan_duration_ms, detector_count, error_count", async () => {
    const detectors: Detector[] = [
      stubDetector("slash-command", { collisions: [] }),
      stubDetector("skill-name", { collisions: [] }),
    ];
    const report = await new Scanner({
      detectors,
      detectorTimeoutMs: 100,
    }).run(emptySnapshot);
    expect(typeof report.metadata.timestamp).toBe("string");
    expect(typeof report.metadata.scan_duration_ms).toBe("number");
    expect(report.metadata.detector_count).toBe(2);
    expect(report.metadata.error_count).toBe(0);
  });

  it("DetectorTimeoutError carries detector name and timeoutMs", () => {
    const err = new DetectorTimeoutError("hook-matcher", 100);
    expect(err.detector).toBe("hook-matcher");
    expect(err.timeoutMs).toBe(100);
    expect(err.message).toContain("100");
  });

  it("defaults to the full 6-detector registry when no detectors are supplied", () => {
    const scanner = new Scanner();
    expect(scanner.detectors.length).toBe(6);
    const categories = scanner.detectors.map((d) => d.category).sort();
    expect(categories).toEqual(
      [
        "hook-matcher",
        "mcp-identifier",
        "path-binary",
        "skill-name",
        "slash-command",
        "subagent-type",
      ].sort(),
    );
  });
});
