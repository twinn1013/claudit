import { describe, expect, it } from "vitest";
import { Report } from "../src/report.js";
import type { Collision } from "../src/types.js";

const fixtureCollision: Collision = {
  category: "slash-command",
  severity: "warning",
  confidence: "definite",
  entities_involved: ["plugin-a:/scan", "plugin-b:/scan"],
  suggested_fix: [
    {
      command: "/plugin uninstall plugin-b",
      scope: "global",
      safety_level: "destructive",
      rationale: "Remove the duplicate command registration.",
    },
  ],
  message: "Two plugins register /scan.",
};

describe("Report.fromCollisions", () => {
  it("fills metadata with sensible defaults and counts internal-errors", () => {
    const internalError: Collision = {
      ...fixtureCollision,
      category: "internal-error",
      confidence: "unknown",
      entities_involved: ["hook-matcher"],
      suggested_fix: [],
      message: "detector timed out",
    };
    const report = Report.fromCollisions([fixtureCollision, internalError]);
    expect(report.metadata.error_count).toBe(1);
    expect(report.metadata.detector_count).toBe(0); // default when not provided
    expect(report.metadata.scan_duration_ms).toBe(0);
    expect(typeof report.metadata.timestamp).toBe("string");
    expect(report.collisions).toHaveLength(2);
  });

  it("respects explicit metadata overrides", () => {
    const report = Report.fromCollisions([fixtureCollision], {
      timestamp: "2026-04-20T00:00:00.000Z",
      scan_duration_ms: 42,
      detector_count: 6,
      error_count: 0,
    });
    expect(report.metadata.timestamp).toBe("2026-04-20T00:00:00.000Z");
    expect(report.metadata.scan_duration_ms).toBe(42);
    expect(report.metadata.detector_count).toBe(6);
    expect(report.metadata.error_count).toBe(0);
  });
});

describe("Report.serialize / parse", () => {
  it("produces a <claudit-report> wrapper around base64-encoded JSON", () => {
    const report = Report.fromCollisions([fixtureCollision], {
      detector_count: 6,
    });
    const wrapped = report.serialize();
    expect(wrapped.startsWith("<claudit-report>")).toBe(true);
    expect(wrapped.endsWith("</claudit-report>")).toBe(true);
    const inner = wrapped.slice(
      "<claudit-report>".length,
      wrapped.length - "</claudit-report>".length,
    );
    // inner must be pure base64 — no raw JSON characters
    expect(inner).toMatch(/^[A-Za-z0-9+/=]+$/);
    // decoding it must yield valid JSON
    expect(() => JSON.parse(Buffer.from(inner, "base64").toString("utf8"))).not.toThrow();
  });

  it("round-trips through parse with lossless fidelity", () => {
    const report = Report.fromCollisions([fixtureCollision], {
      timestamp: "2026-04-20T00:00:00.000Z",
      scan_duration_ms: 17,
      detector_count: 6,
      error_count: 0,
    });
    const restored = Report.parse(report.serialize());
    expect(restored.data).toEqual(report.data);
  });

  it("extracts a <claudit-report> block embedded in a larger string", () => {
    const report = Report.fromCollisions([fixtureCollision]);
    const embedded = `prefix text\n${report.serialize()}\nsuffix`;
    const restored = Report.parse(embedded);
    expect(restored.collisions[0].entities_involved).toEqual(
      fixtureCollision.entities_involved,
    );
  });

  it("throws when no <claudit-report> block is present", () => {
    expect(() => Report.parse("no block here")).toThrow(/no <claudit-report>/);
  });
});
