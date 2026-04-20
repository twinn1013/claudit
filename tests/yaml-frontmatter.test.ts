import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  extractFrontmatter,
  parseYamlSubset,
} from "../src/yaml-frontmatter.js";

describe("extractFrontmatter", () => {
  it("returns text between the first two --- delimiters", () => {
    const src = "---\nname: foo\ndescription: bar\n---\nbody\n";
    expect(extractFrontmatter(src)).toBe("name: foo\ndescription: bar");
  });

  it("returns null when the file does not start with ---", () => {
    expect(extractFrontmatter("just text\n")).toBeNull();
  });

  it("returns null when there is no closing ---", () => {
    expect(extractFrontmatter("---\nname: foo\nbody\n")).toBeNull();
  });

  it("tolerates a leading BOM", () => {
    const src = "\uFEFF---\nname: foo\n---\n";
    expect(extractFrontmatter(src)).toBe("name: foo");
  });
});

describe("parseYamlSubset — supported constructs", () => {
  it("parses scalar key: value pairs", () => {
    const { fields, parseWarnings } = parseYamlSubset(
      "name: foo\ndescription: bar\nlevel: 3\nenabled: true\n",
    );
    expect(parseWarnings).toEqual([]);
    expect(fields).toEqual({
      name: "foo",
      description: "bar",
      level: 3,
      enabled: true,
    });
  });

  it("parses inline list syntax", () => {
    const { fields, parseWarnings } = parseYamlSubset(
      'triggers: ["deep dive", "deep-dive"]\n',
    );
    expect(parseWarnings).toEqual([]);
    expect(fields.triggers).toEqual(["deep dive", "deep-dive"]);
  });

  it("parses block list syntax", () => {
    const src = [
      "triggers:",
      '  - "deep dive"',
      '  - "deep-dive"',
      "  - plain",
      "",
    ].join("\n");
    const { fields, parseWarnings } = parseYamlSubset(src);
    expect(parseWarnings).toEqual([]);
    expect(fields.triggers).toEqual(["deep dive", "deep-dive", "plain"]);
  });

  it("parses mixed scalars, inline lists, and block lists", () => {
    const src = [
      "name: demo",
      "description: test skill",
      "triggers:",
      "  - a",
      "  - b",
      "keywords: [x, y, z]",
      "",
    ].join("\n");
    const { fields, parseWarnings } = parseYamlSubset(src);
    expect(parseWarnings).toEqual([]);
    expect(fields).toEqual({
      name: "demo",
      description: "test skill",
      triggers: ["a", "b"],
      keywords: ["x", "y", "z"],
    });
  });

  it("returns empty fields for empty input", () => {
    const { fields, parseWarnings } = parseYamlSubset("");
    expect(fields).toEqual({});
    expect(parseWarnings).toEqual([]);
  });

  it("strips inline quotes from scalar values", () => {
    const { fields } = parseYamlSubset('name: "with spaces"\nlabel: \'hello\'\n');
    expect(fields.name).toBe("with spaces");
    expect(fields.label).toBe("hello");
  });
});

describe("parseYamlSubset — unsupported constructs emit warnings (R2)", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("warns on folded multiline scalar indicator >", () => {
    const src = ["description: >", "  long line 1", "  long line 2", ""].join(
      "\n",
    );
    const { fields, parseWarnings } = parseYamlSubset(src);
    expect(parseWarnings.length).toBeGreaterThan(0);
    expect(parseWarnings.join(" ")).toMatch(/unsupported multiline scalar/i);
    expect(warnSpy).toHaveBeenCalled();
    // Still produce *some* entry so downstream doesn't see total loss.
    expect(fields).toHaveProperty("description");
  });

  it("warns on literal multiline scalar indicator |", () => {
    const src = ["description: |", "  line 1", "  line 2", ""].join("\n");
    const { parseWarnings } = parseYamlSubset(src);
    expect(parseWarnings.length).toBeGreaterThan(0);
    expect(parseWarnings.join(" ")).toMatch(/unsupported multiline scalar/i);
  });

  it("warns on flow mapping {a: 1}", () => {
    const { parseWarnings } = parseYamlSubset("triggers: {a: 1, b: 2}\n");
    expect(parseWarnings.length).toBeGreaterThan(0);
    expect(parseWarnings.join(" ")).toMatch(/unsupported flow mapping/i);
    expect(warnSpy).toHaveBeenCalled();
  });

  it("warns on YAML anchor &foo", () => {
    const { parseWarnings } = parseYamlSubset("anchor: &foo value\n");
    expect(parseWarnings.length).toBeGreaterThan(0);
    expect(parseWarnings.join(" ")).toMatch(/anchor|alias/i);
  });

  it("warns on YAML alias *foo", () => {
    const { parseWarnings } = parseYamlSubset("alias: *foo\n");
    expect(parseWarnings.length).toBeGreaterThan(0);
    expect(parseWarnings.join(" ")).toMatch(/anchor|alias/i);
  });

  it("warns on YAML merge key <<:", () => {
    const { parseWarnings } = parseYamlSubset("<<: defaults\n");
    expect(parseWarnings.length).toBeGreaterThan(0);
    expect(parseWarnings.join(" ")).toMatch(/merge key/i);
  });

  it("positive+negative pair: supported construct produces no warning", () => {
    const { parseWarnings: good } = parseYamlSubset(
      "triggers: [a, b]\nname: x\n",
    );
    expect(good).toEqual([]);

    const { parseWarnings: bad } = parseYamlSubset("triggers: {a: 1}\n");
    expect(bad.length).toBeGreaterThan(0);
  });
});
