import { describe, expect, it } from "vitest";
import {
  buildQualifiedPluginName,
  pluginQualifiedName,
  resolvePluginEnabledState,
} from "../src/plugin-identity.js";

describe("plugin identity", () => {
  it("builds marketplace-qualified plugin names centrally", () => {
    expect(buildQualifiedPluginName("foo", "alpha")).toBe("foo@alpha");
    expect(buildQualifiedPluginName("foo")).toBe("foo");
  });

  it("resolves enabled state by qualified key before bare name", () => {
    const plugin = {
      name: "foo",
      marketplace: "beta",
      qualifiedName: pluginQualifiedName({ name: "foo", marketplace: "beta" }),
    };
    const enabledMap = {
      foo: false,
      "foo@beta": true,
    };

    expect(resolvePluginEnabledState(plugin, enabledMap)).toBe(true);
  });
});
