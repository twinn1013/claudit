import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    "hooks/post-tool-use": "src/hooks/post-tool-use.ts",
    "hooks/session-start": "src/hooks/session-start.ts",
    "commands/scan": "src/commands/scan.ts",
    scanner: "src/scanner.ts",
  },
  format: ["esm"],
  outDir: "dist",
  outExtension: () => ({ js: ".mjs" }),
  target: "node20",
  clean: true,
  splitting: false,
  sourcemap: false,
  dts: false,
  shims: false,
});
