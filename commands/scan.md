---
description: Scan for configuration conflicts across installed plugins, hooks, commands, MCP servers, and PATH binaries
---

Run a full claudit scan and report any collisions found.

Invoke the scanner by reading `$CLAUDE_PLUGIN_ROOT/dist/scanner.mjs` output, then summarize the `<claudit-report>` block in natural language: describe each collision, its severity and confidence, and propose concrete fix commands. Ask the user for approval before executing any fix.
