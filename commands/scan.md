---
description: Scan for configuration conflicts across installed plugins, hooks, commands, MCP servers, and PATH binaries
---

# /claudit scan

Run a full conflict scan on demand, then walk the user through any findings in natural language.

## Step 1 — run the scanner

Execute the compiled scanner CLI via the Bash tool:

```bash
node "$CLAUDE_PLUGIN_ROOT/dist/commands/scan.mjs"
```

The command prints a single line wrapped in `<claudit-report>...</claudit-report>` tags. The content between the tags is a **base64-encoded JSON payload** — decode it with `Buffer.from(content, "base64").toString("utf8")` (Node.js) or `atob(content)` (browser/Deno) before parsing as JSON.

The decoded JSON payload has this shape:

```json
{
  "collisions": [
    {
      "category": "hook-matcher|slash-command|skill-name|subagent-type|mcp-identifier|path-binary|internal-error",
      "severity": "critical|warning|info",
      "confidence": "definite|possible|unknown",
      "entities_involved": ["..."],
      "suggested_fix": [{ "command": "...", "scope": "...", "safety_level": "...", "rationale": "..." }],
      "message": "human summary"
    }
  ],
  "metadata": { "timestamp": "...", "scan_duration_ms": N, "detector_count": 6, "error_count": N }
}
```

## Step 2 — explain the findings

- If `collisions` is empty, tell the user "no conflicts detected" and show the scan duration.
- Otherwise, for each collision: translate `category` + `message` into one clear sentence, then list the `entities_involved`. Always surface the `confidence` field — `definite` warrants action, `possible` warrants review, `unknown` means a detector failed and the scan is incomplete.

## Step 3 — propose fixes

For each collision, present the `suggested_fix` commands as numbered options. Never run a `destructive` or `manual-review` fix without explicit user approval. `safe` fixes may be offered inline but still require the user to say yes before execution.

If the user approves, invoke the fix via the appropriate tool (Bash for shell commands, Edit for file changes). After the fix, re-run `/claudit scan` and confirm the collision is gone.
