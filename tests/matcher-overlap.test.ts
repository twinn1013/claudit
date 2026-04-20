import { describe, expect, it } from "vitest";
import { matchersOverlap, parseMatcher } from "../src/matcher-overlap.js";

describe("parseMatcher", () => {
  it("undefined → wildcard", () => {
    expect(parseMatcher(undefined)).toEqual({ wildcard: true });
  });
  it("empty string → wildcard", () => {
    expect(parseMatcher("")).toEqual({ wildcard: true });
  });
  it("whitespace-only → wildcard", () => {
    expect(parseMatcher("   ")).toEqual({ wildcard: true });
  });
  it('"*" → wildcard', () => {
    expect(parseMatcher("*")).toEqual({ wildcard: true });
  });
  it("singleton parses to one-element set", () => {
    const r = parseMatcher("Bash");
    expect(r).toEqual({ wildcard: false, tools: new Set(["Bash"]) });
  });
  it("pipe-OR parses to multi-element set", () => {
    const r = parseMatcher("Edit|Write");
    expect(r).toEqual({ wildcard: false, tools: new Set(["Edit", "Write"]) });
  });
  it("pipe-OR with whitespace inside pieces is trimmed", () => {
    const r = parseMatcher("Edit| |Write");
    // the blank piece " " trims to "" and is skipped
    expect(r).toEqual({ wildcard: false, tools: new Set(["Edit", "Write"]) });
  });
  it("pipe-OR with leading pipe skips empty piece", () => {
    const r = parseMatcher("|Edit");
    expect(r).toEqual({ wildcard: false, tools: new Set(["Edit"]) });
  });
  it("three-part OR: startup|clear|compact", () => {
    const r = parseMatcher("startup|clear|compact");
    expect(r).toEqual({
      wildcard: false,
      tools: new Set(["startup", "clear", "compact"]),
    });
  });
  it('union containing "*" widens to wildcard', () => {
    expect(parseMatcher("Edit|*")).toEqual({ wildcard: true });
  });
});

describe("matchersOverlap", () => {
  // wildcard cases
  it("* overlaps *", () => {
    expect(matchersOverlap(parseMatcher("*"), parseMatcher("*"))).toBe(true);
  });
  it("* overlaps singleton Edit", () => {
    expect(matchersOverlap(parseMatcher("*"), parseMatcher("Edit"))).toBe(true);
  });
  it("* overlaps pipe-OR Edit|Write", () => {
    expect(
      matchersOverlap(parseMatcher("*"), parseMatcher("Edit|Write")),
    ).toBe(true);
  });
  it("* overlaps empty string", () => {
    expect(matchersOverlap(parseMatcher("*"), parseMatcher(""))).toBe(true);
  });
  it("* overlaps undefined", () => {
    expect(matchersOverlap(parseMatcher("*"), parseMatcher(undefined))).toBe(
      true,
    );
  });

  // Edit|Write cases
  it("Edit|Write overlaps Edit", () => {
    expect(
      matchersOverlap(parseMatcher("Edit|Write"), parseMatcher("Edit")),
    ).toBe(true);
  });
  it("Edit|Write overlaps Write", () => {
    expect(
      matchersOverlap(parseMatcher("Edit|Write"), parseMatcher("Write")),
    ).toBe(true);
  });
  it("Edit|Write overlaps Edit|Write (self)", () => {
    expect(
      matchersOverlap(parseMatcher("Edit|Write"), parseMatcher("Edit|Write")),
    ).toBe(true);
  });
  it("Edit|Write overlaps *", () => {
    expect(
      matchersOverlap(parseMatcher("Edit|Write"), parseMatcher("*")),
    ).toBe(true);
  });
  it("Edit|Write does NOT overlap Bash", () => {
    expect(
      matchersOverlap(parseMatcher("Edit|Write"), parseMatcher("Bash")),
    ).toBe(false);
  });

  // startup|clear|compact cases
  it("startup|clear|compact overlaps *", () => {
    expect(
      matchersOverlap(
        parseMatcher("startup|clear|compact"),
        parseMatcher("*"),
      ),
    ).toBe(true);
  });
  it("startup|clear|compact overlaps startup", () => {
    expect(
      matchersOverlap(
        parseMatcher("startup|clear|compact"),
        parseMatcher("startup"),
      ),
    ).toBe(true);
  });
  it("startup|clear|compact overlaps clear|init (shared clear)", () => {
    expect(
      matchersOverlap(
        parseMatcher("startup|clear|compact"),
        parseMatcher("clear|init"),
      ),
    ).toBe(true);
  });
  it("startup|clear|compact does NOT overlap Bash|Read", () => {
    expect(
      matchersOverlap(
        parseMatcher("startup|clear|compact"),
        parseMatcher("Bash|Read"),
      ),
    ).toBe(false);
  });

  // Disjoint singletons
  it("Bash and Read → no overlap", () => {
    expect(
      matchersOverlap(parseMatcher("Bash"), parseMatcher("Read")),
    ).toBe(false);
  });
});
