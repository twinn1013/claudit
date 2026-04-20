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
      "suggested_fix": [{ "command": "...", "scope": "...", "safety_level": "safe|destructive|manual-review", "rationale": "..." }],
      "message": "human summary"
    }
  ],
  "metadata": { "timestamp": "...", "scan_duration_ms": 42, "detector_count": 6, "error_count": 0 }
}
```

## Step 2 — explain the findings

Apply all 8 directives below when interpreting the payload.

### Directives for Claude

1. **Base64 decode** the JSON payload from `<claudit-report>` tags before parsing. The raw tag content is base64 — do not parse it directly as JSON.

2. **Map `severity` to visual badges** when presenting each collision:
   - `critical` → ❗CRITICAL
   - `high` → ⚠️HIGH
   - `warning` → ⚠️WARNING
   - `medium` → ⚠️MEDIUM
   - `low` → ℹ️LOW
   - `info` → ℹ️INFO

   Show the badge next to the `message` field so severity is immediately visible.

3. **Gate fix suggestions by `safety_level`**: only offer "run this command" for `safety_level: "safe"` fixes. For `safety_level: "manual-review"`, say "review manually" and describe the steps from the `rationale` field. Never auto-run a `destructive` fix — explain what it would do and require explicit user confirmation before proceeding.

4. **Empty command + manual-review**: when `FixSuggestion.command === ""` and `safety_level: "manual-review"`, do not show an empty command block. Instead, describe the manual remediation steps based on the `rationale` field in plain prose.

5. **No fix suggestion**: for collisions with `suggested_fix: []`, explain why no automated fix is available rather than fabricating one. Example: "This is a namespace ambiguity — Claude Code already handles it via plugin-qualified names, so there is nothing to uninstall or disable."

6. **Group findings by detector category** for readability. Present them in this order: hook-matcher, slash-command, skill-name, subagent-type, mcp-identifier, path-binary, internal-error. Within each group, sort by severity (critical first).

7. **Clean scan confirmation**: if `collisions: []`, say explicitly "no conflicts detected" and show the `scan_duration_ms` value. Do not stay silent or omit the confirmation.

8. **(C3) Namespace disambiguation** — for collisions with `category` in `{slash-command, skill-name, subagent-type}` and `severity: "info"`: do NOT suggest uninstalling or disabling either plugin. Claude Code already resolves these via plugin-qualified names. Explain the disambiguation syntax instead:
   - Slash commands: `/plugin-a:scan` vs `/plugin-b:scan`
   - Skills: `plugin-a:skill-name` to invoke a skill from a specific plugin
   - Agents: `Task(subagent_type="plugin-a:agent-name")` to target a specific plugin's agent

### Example output (one collision)

> ⚠️WARNING — Hook matcher interference on PostToolUse/\*: two hooks from plugin-a and plugin-b both mutate `updatedInput`; the later hook silently overwrites the earlier one.
>
> **Entities involved:** plugin-a:PostToolUse:\*, plugin-b:PostToolUse:\*
> **Confidence:** definite — warrants action
>
> **Suggested fix (safe):** Run `claude plugin inspect plugin-a` to review its hook configuration.

## Step 3 — propose fixes

For each collision with a non-empty `suggested_fix`, present the fix options as numbered items. Do not run any fix without user confirmation — even `safe` fixes require the user to say yes.

If the user approves a fix, invoke it via the appropriate tool (Bash for shell commands, Edit for file changes). After the fix, re-run `/claudit scan` to confirm the collision is gone.

For `confidence: "unknown"` collisions (detector error or timeout), note that the scan is incomplete and suggest re-running after addressing the error shown in `metadata.error_count`.
