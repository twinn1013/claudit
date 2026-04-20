import { describe, expect, it } from "vitest";
import { Report } from "../../src/report.js";
import type { Collision } from "../../src/types.js";

const baseCollision: Collision = {
  category: "slash-command",
  severity: "warning",
  confidence: "definite",
  entities_involved: ["plugin-a:/scan", "plugin-b:/scan"],
  suggested_fix: [],
  message: "Two plugins register /scan.",
};

describe("Report base64 wrapper — escape-proof round-trip", () => {
  it("round-trips a normal report through serialize/parse", () => {
    const report = Report.fromCollisions([baseCollision], {
      timestamp: "2026-04-20T00:00:00.000Z",
      scan_duration_ms: 10,
      detector_count: 6,
      error_count: 0,
    });
    const restored = Report.parse(report.serialize());
    expect(restored.data).toEqual(report.data);
  });

  it("round-trips payload containing literal </claudit-report> in a collision message", () => {
    const dangerous: Collision = {
      ...baseCollision,
      message: "inject </claudit-report> here",
    };
    const report = Report.fromCollisions([dangerous]);
    const restored = Report.parse(report.serialize());
    expect(restored.collisions[0].message).toBe("inject </claudit-report> here");
  });

  it("round-trips payload containing literal </claudit-report> in entities_involved path", () => {
    const dangerous: Collision = {
      ...baseCollision,
      entities_involved: ["/home/user/.claude/</claudit-report>/plugin.json"],
    };
    const report = Report.fromCollisions([dangerous]);
    const restored = Report.parse(report.serialize());
    expect(restored.collisions[0].entities_involved[0]).toBe(
      "/home/user/.claude/</claudit-report>/plugin.json",
    );
  });

  it("round-trips payload containing <claudit-report> opening tag inside a path", () => {
    const dangerous: Collision = {
      ...baseCollision,
      entities_involved: ["/evil/<claudit-report>/path"],
    };
    const report = Report.fromCollisions([dangerous]);
    const restored = Report.parse(report.serialize());
    expect(restored.collisions[0].entities_involved[0]).toBe(
      "/evil/<claudit-report>/path",
    );
  });

  it("round-trips payload containing control characters, unicode, and emoji", () => {
    const exotic: Collision = {
      ...baseCollision,
      message: "tabs\there\nnewlines\0null \u0001 \u{1F600} 日本語 العربية",
      entities_involved: ["\u0000path\u001Fwith\u007Fcontrols"],
    };
    const report = Report.fromCollisions([exotic]);
    const restored = Report.parse(report.serialize());
    expect(restored.collisions[0].message).toBe(exotic.message);
    expect(restored.collisions[0].entities_involved[0]).toBe(
      exotic.entities_involved[0],
    );
  });

  it("serialized output contains only base64 chars between the tags", () => {
    const report = Report.fromCollisions([baseCollision]);
    const wrapped = report.serialize();
    const inner = wrapped.slice(
      "<claudit-report>".length,
      wrapped.length - "</claudit-report>".length,
    );
    expect(inner).toMatch(/^[A-Za-z0-9+/=]+$/);
  });
});

describe("Report.parse — negative cases", () => {
  it("throws when no <claudit-report> block is present", () => {
    expect(() => Report.parse("no tags here")).toThrow(/no <claudit-report>/);
  });

  it("throws on <claudit-report> with content that is not valid base64 chars", () => {
    // Contains characters not in base64 alphabet (spaces, angle brackets)
    expect(() =>
      Report.parse("<claudit-report>not valid base64!</claudit-report>"),
    ).toThrow(/no <claudit-report>/);
  });

  it("throws when base64 decodes to invalid JSON", () => {
    // "invalid json" base64-encoded
    const b64 = Buffer.from("invalid json").toString("base64");
    expect(() =>
      Report.parse(`<claudit-report>${b64}</claudit-report>`),
    ).toThrow(/invalid JSON/);
  });

  it("throws on the specific aW52YWxpZCBqc29u test vector (valid base64, not JSON)", () => {
    // aW52YWxpZCBqc29u decodes to "invalid json"
    expect(() =>
      Report.parse(
        "<claudit-report>aW52YWxpZCBqc29u</claudit-report>",
      ),
    ).toThrow(/invalid JSON/);
  });
});
