# v0.2 Plan — Open Deltas (Post-Approval Audit, 2026-04-20)

The iteration-2 consensus plan is APPROVED (Architect + Critic). A post-approval audit against the external-review findings surfaced **2 partial closures** that the next session should decide on before Stage 0 executes.

## Delta 1 — MCP probe paths (Codex CRITICAL #1)

**Status:** 3 of 4 expected paths covered.

**Covered by iteration-2 plan (Stage 4):**
- ✅ Plugin manifest `mcpServers` string-path form (`"./.mcp.json"`)
- ✅ Project-level `.mcp.json`
- ✅ User-level `~/.claude/.mcp.json` and `settings.json.mcpServers` (per Limitations line 671)

**Missing:** `~/.claude.json` at home root — Codex's original finding mentioned this explicitly. Research phase confirmed it doesn't exist on this machine, so the plan treats it as "variance across CC versions" in Limitations. It is NOT in Stage 1's probe list.

**Options:**
- **(A) Add to probe list** — Stage 1 `captureUserSettings` walks a probe list: `[~/.claude.json, ~/.claude/.mcp.json, ~/.claude/settings.json#mcpServers]`. If a path doesn't exist, skip silently. Cost: ~5 lines of code, no test surface.
- **(B) Accept current plan** — document `~/.claude.json` as "not probed because empirically absent on this install; add later if a real user reports MCP servers living there."

**Recommendation:** Option A. The plan already probes two user-level candidates; adding a third makes claudit robust across CC versions without measurable cost.

## Delta 2 — Hook scope + hook type coverage (Codex CRITICAL #2)

**Status:** Partial on two axes.

**Scope axis — covered:**
- ✅ plugin-cache, plugin-marketplace
- ✅ user-settings, user-settings-local
- ✅ project-settings, project-settings-local

**Scope axis — missing:** `managed` (enterprise-policy settings) is not in the `HookSource` enum. Some enterprise CC installs inject hooks via a managed settings file that users cannot edit. claudit would miss these.

**Hook type axis — missing:** Plan assumes `{type: "command"}` for every hook entry, carrying over v0.1. CC also supports `prompt`, `agent`, and `http` hook types. Non-command hooks would be misparsed or silently dropped.

**Options:**
- **(A) Add `user-managed` as 7th `HookSource` value** + extend `captureUserSettings` to probe a managed settings path. Cost: ~5 lines + 1 test fixture.
- **(B) Accept current plan** — document that managed settings are v0.3+ scope.
- **(C) Non-command hook types** — tag them in Stage 1 with `HookScript.kind: 'command' | 'prompt' | 'agent' | 'http' | 'unknown'` and have detectors classify non-command kinds as `confidence: unknown` instead of dropping. Cost: ~10 lines + 1 test.
- **(D) Reject C** — document as known gap; v0.2 only handles command hooks; non-command types pass through unscanned.

**Recommendation:** A + C. Both are small, both improve coverage without architectural disruption. Without them, the plan says "5-scope capture" but actually delivers 3-scope-with-1-type. A and C close the integrity gap between the marketing and the mechanism.

## What to do before Stage 0

Next session:
1. Read this file.
2. Decide per delta: patch the plan (add a Stage 1.1 sub-task or extend Stage 1 exit criteria) OR accept as known v0.2 limitation.
3. If patched, update `iteration-2/01-planner-revised.md` and bump a note in `CONSENSUS.md`. Re-review NOT required for these additive fixes — both are ≤15 lines of code each.
4. Then start Stage 0 `[v2-types]`.
