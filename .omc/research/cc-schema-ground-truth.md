# Claude Code Plugin Schema — Ground Truth (2026-04-20)

Evidence-based audit of real CC installations on macOS, collected before v0.2 redesign.

## Plugin Directory Layouts (both coexist)

1. **Versioned cache** (primary install path):
   ```
   ~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/
     .claude-plugin/
       plugin.json
       marketplace.json   (when marketplace-only distribution)
     hooks/hooks.json
     commands/*.md
     skills/<name>/SKILL.md
     agents/*.md
     .mcp.json
   ```

2. **Marketplace root** (contains marketplace-level + nested plugin dirs):
   ```
   ~/.claude/plugins/marketplaces/<marketplace>/
     .claude-plugin/marketplace.json
     hooks/hooks.json          <-- marketplace-level hooks (observed: omc)
     skills/*/SKILL.md
     agents/*.md
     .mcp.json
     plugins/<plugin>/         <-- nested plugins under marketplace
       hooks/hooks.json
       ...
   ```

Implications: plugin root discovery must walk **2 AND 3 levels deep** and treat both `cache/<m>/<p>/<ver>/` and `marketplaces/<m>/` as potential plugin roots. v0.1 walks 1-2 levels deep only; misses everything under `cache/` because it looked at `cache/<m>/` as the plugin root but plugin.json is at `cache/<m>/<p>/<ver>/.claude-plugin/plugin.json`.

## plugin.json Field Variance

Observed shapes across `omc`, `vercel`, `karpathy-skills`, `openai-codex`, `claude-mem`:

```jsonc
{
  "name": "string",                    // always
  "version": "string",                 // always
  "description": "string",
  "author": { "name": "...", "url": "..." },
  "repository": "string",
  "homepage": "string",
  "license": "string",
  "keywords": ["..."],

  "commands": ["./commands/x.md", ...],        // array of string paths  (vercel)
  "agents":   ["./agents/x.md",   ...],        // array of string paths  (vercel)
  "skills":   "./skills/",                      // STRING dir path        (omc)
  "skills":   ["./skills/foo"],                 // array of paths         (karpathy)
  "skills":   "./skills/foo",                   // single string path also seen
  "mcpServers": "./.mcp.json",                  // STRING path to .mcp.json (omc)
  "mcpServers": { "server": { ... } }           // inline object (hypothetical)
}
```

v0.1 assumed `commands` object-array, `skills` absent, `mcpServers` object only. v0.2 must handle all variants.

## Hook Sources (5 distinct scopes)

1. **Plugin-level** (currently scanned): `<plugin-root>/hooks/hooks.json`.
2. **User-level** (MISSED by v0.1): `~/.claude/settings.json.hooks`. Confirmed on this machine with `"rtk hook claude"` PreToolUse:Bash hook.
3. **User-local-level** (MISSED by v0.1): `~/.claude/settings.local.json.hooks` — same shape, per-user overrides (can be gitignored per-project).
4. **Project-level** (MISSED by v0.1): `<cwd>/.claude/settings.json.hooks`.
5. **Project-local-level** (MISSED by v0.1): `<cwd>/.claude/settings.local.json.hooks`.

v0.1's spec explicitly lists "rtk + OMC" as the canonical scenario — but that scenario fires from `settings.json.hooks`, which v0.1 doesn't scan. claudit currently would miss its own flagship example.

## Hook Event Coverage

Events observed in the wild (not just PostToolUse/SessionStart):

- `UserPromptSubmit`
- `SessionStart` (with matchers: `*`, `init`, `maintenance`, `startup|clear|compact`)
- `PreToolUse`
- `PermissionRequest`
- `PostToolUse`
- `PostToolUseFailure`
- `SubagentStart`
- `SubagentStop`
- `PreCompact`
- `Stop`
- `SessionEnd`
- `Setup` (claude-mem)

v0.2 detector must group by actual event name, not hardcode event set.

## Matcher Semantics

Observed matcher values:

- `"*"` — all tools/events
- Specific tool: `"Bash"`, `"Read"`, `"Edit"`
- Pipe-OR list: `"startup|clear|compact"`, `"Edit|Write"`  (regex-like alternation)
- Omitted key — treated as `"*"` by convention in claude-mem's UserPromptSubmit entry
- Empty string `""` — also seen, semantically equivalent to omitted
- SessionStart-specific sub-matchers: `"init"`, `"maintenance"` — scope to sub-event

Matcher overlap (the v0.1 regex-grouping blind spot):
- `"*"` overlaps with everything
- `"Bash"` and `"*"` overlap
- `"Edit|Write"` overlaps with `"Edit"`, `"Write"`, and `"*"`
- Regex overlap detection needed; literal string equality is insufficient.

## Plugin Enablement

`~/.claude/settings.json.enabledPlugins` shape:

```json
{
  "codex@openai-codex": true,
  "oh-my-claudecode@omc": true,
  "superpowers@claude-plugins-official": false
}
```

Disabled plugins are still on disk. Conflict detection must respect the `enabled` flag OR report disabled plugins with separate severity (not `definite`).

## Namespace Semantics (commands, skills, agents)

Empirical: tool definitions in Claude Code expose plugin identifiers **prefixed by plugin name**:

- `oh-my-claudecode:code-reviewer` (agent)
- `vibe-sunsang:vibe-sunsang-retro` (skill)
- `vercel:deploy` (slash command — maps to `vercel:deploy`)

Two plugins that both define an identifier named `scan` are NOT a hard collision — users can disambiguate with `plugin:scan`. It's an **ambiguity warning** (user-typed `/scan` with no prefix becomes ambiguous), not a `definite` conflict.

v0.1 produces `definite` + destructive fix advice for these. Both the classification and the advice are wrong.

## Agent Frontmatter Schema

Confirmed shape (from observed agent `.md` files):

```yaml
---
name: code-reviewer        # THIS is the subagent_type at invocation
description: ...
model: claude-opus-4-6
level: 3
disallowedTools: Write, Edit
---
```

No `type` or `subagent_type` field — `name` IS the callable identifier, consumed by the Agent tool's `subagent_type` parameter. When exposed, it's prefixed by plugin name.

## Skill Frontmatter Schema

Confirmed shape (from observed SKILL.md files):

```yaml
---
name: deep-dive
description: "..."
argument-hint: "..."
triggers:
  - "deep dive"
  - "deep-dive"
pipeline: [deep-dive, omc-plan, autopilot]
next-skill: omc-plan
---
```

Variance:
- `triggers` is sometimes a YAML block list (indented `-`), sometimes inline list `[a, b]`, sometimes absent.
- Other fields like `level`, `model`, `handoff`, `pipeline` carry no collision meaning but must not break parsing.

v0.1's line-based key:value parser cannot read block lists at all — it treats `triggers:` as an empty value and walks the `-` lines as "key — value" lines (or skips them). Every skill with a block-list `triggers` gives a silent false negative.

## MCP Configuration Paths

Observed plugin-local `.mcp.json` files:

```
~/.claude/plugins/cache/omc/oh-my-claudecode/4.11.6/.mcp.json
~/.claude/plugins/cache/claude-plugins-official/vercel/0.40.0/.mcp.json
~/.claude/plugins/cache/thedotmack/claude-mem/12.1.6/.mcp.json
~/.claude/plugins/marketplaces/omc/.mcp.json
```

Referenced from `plugin.json.mcpServers` as string path `./.mcp.json`. `.mcp.json` itself has the actual server config.

User-level MCP servers: Codex suggested `~/.claude.json`, not present on this machine — the actual user MCP list lives in either `~/.claude/.mcp.json` or `settings.json.mcpServers` depending on CC version. Need to probe both.

## Missing Settings Fields

`settings.json` may contain (besides `hooks`):
- `mcpServers` — user-level MCP
- `enabledPlugins` — plugin on/off map
- `permissions` — tool allow/deny lists
- `env` — env vars injected into all tool calls
- `statusLine` — status line command
- `extraKnownMarketplaces` — marketplace sources

`settings.local.json` can override any of these per-user.

## Summary of v0.1 Correctness Gaps

| # | Problem | Severity |
|---|---------|----------|
| 1 | Plugin root discovery depth wrong (1-2 vs actual 2-3 levels) | CRITICAL |
| 2 | Hook sources: only plugin-level scanned; user/project/local/managed missed | CRITICAL |
| 3 | `plugin.json.skills` string form unhandled | HIGH |
| 4 | `plugin.json.mcpServers` string path form unhandled | HIGH |
| 5 | Skill `triggers` block list unparseable (false negatives) | HIGH |
| 6 | Matcher grouping by literal string (overlap semantics missing) | HIGH |
| 7 | Namespace semantics: commands/skills/agents are plugin-prefixed | HIGH |
| 8 | `enabledPlugins` flag ignored | MEDIUM |
| 9 | `<claudit-report>` wrapper not escape-proofed | MEDIUM |
| 10 | `JSON.stringify(updatedInput)` alone misclassified as mutation | MEDIUM |
| 11 | PATH scan: non-executables included | MEDIUM |
| 12 | `lstat().isFile()` rejects legitimate symlink shims | MEDIUM |
| 13 | Pending marker stores raw command (potential secrets) | MEDIUM |
| 14 | Hook script resolver range narrow (.js/.mjs/.sh/.py only) | MEDIUM |
| 15 | FixSuggestion `# comment` entries unexecutable (Claude may try) | MEDIUM |
| 16 | `commands/scan.md` lacks explicit JSON-parsing directive | MEDIUM |
| 17 | Error messages use jargon (`updatedInput`) | LOW |
| 18 | CLAUDE.md missing dev CLI usage | LOW |
| 19 | 4KB static analysis ceiling (indirection missed) | ACCEPTED (design choice) |
