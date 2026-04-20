# claudit v0.2 — Implementation Plan (Iteration 2 — Revised)

**Date:** 2026-04-20
**Basis:** Ground truth audit (`cc-schema-ground-truth.md`), iteration-1 draft, Architect review (R1-R5), Critic review (C1-C4)
**Motivation:** v0.1 shipped 109 passing tests but has 6 CRITICAL/HIGH correctness gaps that cause its flagship scenario (rtk + OMC hook interference) to go undetected.

---

## Changelog vs Iteration-1

All 9 required revisions from Architect (R1-R5) and Critic (C1-C4) are resolved below.

| ID | Source | Revision | Where Applied |
|----|--------|----------|---------------|
| R1 | Architect | Remove `types.ts` from UNTOUCHED. Add Stage 0 for type schema evolution: `PluginAgent.type` -> `name` (breaking), `HookSource` enum, `source`+`enabled` on `PluginSummary`, source metadata on `HookRegistration`. | Section 0 (UNTOUCHED table updated), Stage 0 added (Section 2). |
| R2 | Architect | Stage 1 exit criterion: YAML frontmatter with unsupported construct (multiline folded `>`, flow mapping `{a: 1}`) produces parse warning on stderr, not silent data loss. Warning surfaces in snapshot metadata. | Stage 1 exit criteria, new bullet. |
| R3 | Architect | Split Stage 6 into 6a (report base64 encode/decode hardening) and 6b (redaction + FixSuggestion cleanup + scan.md directives). Independent exit criteria and commits. | Stages 7a and 7b (renumbered due to Stage 0 insertion). |
| R4 | Architect | ralph-verify adds regression criterion: v0.1 test files in `tests/` (excluding `tests/*-v2/` and `tests/e2e/`) produce same pass count. Floor: at least 100 of 109 v0.1 tests pass without modification. | Stage 9 ralph-verify Criterion 6 (Regression). |
| R5 | Architect | Clarify `session-start.ts` UNTOUCHED claim. Snapshot derives user-settings/project-settings/enabledPlugins internally from `globalRoot`/`projectRoot`/env. `session-start.ts` call site needs zero changes — existing `globalRoot` and `projectRoot` args are sufficient. | Section 0 UNTOUCHED table, `session-start.ts` row updated with explicit rationale. |
| C1 | Critic | CCG guardrail: pre-check (`which codex && which gemini \|\| which omc`), concrete prompt templates for each reviewer, fallback rule (blocked if unavailable). | Section 5 Phase 4 guardrail rewritten. |
| C2 | Critic | Redaction expansion to 7+ patterns with per-pattern exit criteria (positive + negative). Limitations sentence on non-exhaustive list. | Stage 7b deliverables/exit criteria, Section 7 Limitation 13. |
| C3 | Critic | scan.md directive 8: for collisions with `category: slash-command|skill-name|subagent-type` and `severity: info`, do NOT suggest uninstalling. Explain prefix disambiguation syntax. | Stage 7b scan.md deliverables (8 directives, not 7). |
| C4 | Critic | Cross-source matcher overlap test in Stage 2: user `settings.json` hook with matcher `*` on PreToolUse + plugin hook with matcher `Bash` on PreToolUse, both mutating, produces collision with `entities_involved` including both `user-settings:PreToolUse:*` and `plugin-name:PreToolUse:Bash`. | Stage 3 exit criteria, new bullet. |

---

## 0. Module Classification

### Modules UNTOUCHED (no code changes)

| Module | Rationale |
|--------|-----------|
| `src/detector.ts` | Async `Detector` interface unchanged. |
| `src/scanner.ts` | `Promise.allSettled` + per-detector timeout orchestration unchanged. |
| `src/hook-io.ts` | stdin parse / stdout builder unchanged. |
| `src/policies.ts` | Constants file. Extended but not rewritten. |
| `src/hooks/post-tool-use.ts` | Trigger logic unchanged. Redaction added as a wrapper around existing pending write (additive, not rewrite). |
| `src/hooks/session-start.ts` | Consume-markers + diff + scan pipeline unchanged. Snapshot derives user-settings, project-settings, and enabledPlugins internally from `globalRoot` and `projectRoot` (both already passed by session-start.ts at line 49-53). No new options required at the call site. **(R5: explicitly confirmed — zero call-site changes needed.)** |

### Modules REWRITTEN (substantial logic replacement)

| Module | What changes | Gap(s) addressed |
|--------|-------------|-----------------|
| `src/types.ts` | **Breaking:** `PluginAgent.type` renamed to `PluginAgent.name`. **Additive:** `HookSource` enum (6 values), `source: HookSource` + `enabled: boolean` on `PluginSummary`, `source: HookSource` on `HookRegistration`, `SettingsHookEntry` type for non-plugin hooks (user/project settings). **(R1)** | #2 (hook sources), #7 (namespace), #8 (enabledPlugins) |
| `src/snapshot.ts` | Full rewrite: 5-scope hook source enum, 3-level-deep plugin cache walk, marketplace root walk, user/project settings capture, `enabledPlugins` filter, YAML frontmatter parser, `plugin.json` field normalization (skills/mcpServers string forms). | #1 (depth), #2 (hook sources), #3 (skills string), #4 (mcpServers string), #5 (YAML triggers), #8 (enabledPlugins) |
| `src/detectors/hook-matcher.ts` | Major refactor: accept hooks from all 5 sources (+ plugin-cache as 6th), matcher-overlap set algebra (not string equality), drop standalone `JSON.stringify` as mutation signal. | #2 (hook sources), #6 (matcher grouping) |
| `src/detectors/slash-command.ts` | Semantics fix: same base name across enabled plugins = `possible/info` (not `definite/destructive`). Remove destructive fix suggestions. | #7 (namespace) |
| `src/detectors/skill-name.ts` | Same namespace semantics fix + YAML block-list trigger parsing delegated to snapshot's new parser. | #5 (triggers), #7 (namespace) |
| `src/detectors/subagent-type.ts` | Same namespace semantics fix. | #7 (namespace) |

### Modules HARDENED (targeted fixes, not rewrite)

| Module | Fix |
|--------|-----|
| `src/detectors/mcp-identifier.ts` | Extend input to include user-level `.mcp.json` and project-level `.mcp.json`. Plugin `mcpServers` string-path resolution. |
| `src/detectors/path-binary.ts` | Filter non-executables (`mode & 0o111`). Follow symlinks with `stat` (not `lstat`). Realpath loop guard. |
| `src/report.ts` | Base64 encode JSON payload inside `<claudit-report>` wrapper. Parser decodes on read. |
| `src/pending.ts` | Redaction pass before disk write: 7+ secret patterns (see Stage 7b). |
| `commands/scan.md` | Add 8 explicit directives: base64 decode, severity badges, fix safety-level gating, empty-command guidance, namespace disambiguation (C3). |
| All detectors | Purge `# comment` pseudo-commands from FixSuggestion. Replace with runnable commands or `safety_level: "manual-review"` with empty command. |
| All Collision messages | Replace jargon (`updatedInput`) with plain language. |

---

## 1. Open Questions Resolved

### Q1: YAML parser strategy

**Decision:** Vendor a minimal subset parser (zero runtime deps).

**Rationale:** claudit needs to parse exactly 3 YAML constructs from skill/agent frontmatter: (a) scalar `key: value`, (b) inline lists `[a, b, c]`, (c) block lists with `- item` entries. Full YAML spec (anchors, aliases, multiline folded strings, merge keys) is unnecessary. A ~80-line parser covering these 3 constructs keeps the zero-runtime-dep guarantee, avoids `js-yaml`'s 65KB bundle, and is fully testable against the ground-truth fixtures.

**Not /ccg eligible.** Only 2 real options (vendor subset vs `js-yaml`); subset wins clearly on the zero-dep constraint.

### Q2: Report wrapper encoding

**Decision:** Base64 encode the JSON payload.

**Rationale:** Base64 is unconditionally escape-proof. Literal-escape (replacing `</claudit-report>` occurrences) works but is fragile against future edge cases (plugin paths containing the sentinel, nested XML-like content). `scan.md` already needs updating; adding "base64-decode the payload" is one directive. Human-readable raw stdout is sacrificed, but `/claudit scan` is Claude-consumed, not human-consumed.

**Not /ccg eligible.** Base64 is strictly safer; the only downside (opacity) is irrelevant for machine-parsed output.

### Q3: Pending marker redaction policy

**Decision:** Conservative (known secret patterns only).

**Rationale:** Aggressive redaction (all query string values) would redact harmless version pins (`?v=3.2.1`), package names in URLs, and diagnostic info that helps the scan report explain what was installed. Conservative policy targets 7 specific patterns (expanded per C2):
1. `?token=...` / `?key=...` / `?secret=...` query params
2. `Authorization: Bearer ...` in curl `-H` args
3. `GITHUB_TOKEN=...` / `*_SECRET=...` / `*_KEY=...` env-var assignments
4. `--password` / `--auth-token` flag values
5. `//registry.npmjs.org/:_authToken=...` (npm publish tokens)
6. Git credential URLs: `https?://[^:/@\s]+:[^@\s]+@[^\s]+`
7. `AWS_ACCESS_KEY_ID=AKIA[0-9A-Z]{16}` (key ID despite name not matching `*_SECRET`/`*_KEY`)

Plus SSH key path patterns as supplementary: `\s-i\s+[\S]+\.pem` / `\s-i\s+[\S]*id_rsa[\S]*`

This catches real secrets without destroying useful context. Extensible via `policies.ts` pattern list. **The pattern list is non-exhaustive; unknown secret formats pass through unredacted (C2 acknowledged limitation).**

**Not /ccg eligible.** Conservative is clearly better; aggressive produces false redactions.

### Q4: Namespace detector behavior for same-name identifiers

**Decision:** Report as `severity: info, confidence: possible` with disambiguation guidance.

**Rationale:** Claude Code's namespace prefix (`plugin:name`) means same-name identifiers across plugins are NOT hard collisions. But a user typing `/scan` without a prefix faces ambiguity. Reporting at `info/possible` is informative without being alarming. The message reads: "Both `plugin-a` and `plugin-b` define `scan`. Use `plugin-a:scan` or `plugin-b:scan` to disambiguate." No fix suggestion is offered (nothing is broken).

Skipping entirely was considered but rejected: ambiguity is real user friction even if not a technical conflict.

**Not /ccg eligible.** Two options (report-info vs skip); report-info serves users better.

### Q5: `enabledPlugins` handling

**Decision:** Include disabled plugins in scan, tag collisions involving disabled plugins as `confidence: possible` with an explanatory note.

**Rationale:** Excluding disabled plugins entirely means claudit cannot warn about conflicts that activate when the user re-enables a plugin. Including them at `possible` confidence gives a heads-up ("this collision would activate if you re-enable `superpowers`") without cluttering the report with `definite` findings the user cannot currently experience.

**Not /ccg eligible.** The third option (exclude entirely) loses information; the second (full scan, same confidence) inflates false positives.

---

## 2. Stage-by-Stage Pipeline

### Stage-token convention

v0.2 reuses v0.1 stage names where the module is the same (e.g., `[snapshot]`, `[detector-hook-matcher]`) but prefixes with `v2-` to disambiguate in git history. Stages for new-to-v0.2 work use descriptive tokens without the `v2-` prefix.

Rationale: `git log --oneline --grep='v2-snapshot'` cleanly separates v0.2 snapshot work from v0.1's. New stages that have no v0.1 counterpart need no prefix.

---

### Stage 0: `[v2-types]` — Type schema evolution (NEW — R1)

- **Goal:** Evolve the type schema to support 5-scope hook sources, plugin enablement, and corrected agent naming before any module rewrites depend on these types.
- **Deliverables:**
  - `src/types.ts` — modified:
    - Add `HookSource` enum with 7 values: `plugin-cache`, `plugin-marketplace`, `user-settings`, `user-settings-local`, `project-settings`, `project-settings-local`, `user-managed`. **(Delta 2a — 2026-04-20 post-approval patch.)**
    - Add `source: HookSource` field to `HookRegistration`.
    - Add `source: HookSource` and `enabled: boolean` fields to `PluginSummary`.
    - Rename `PluginAgent.type` to `PluginAgent.name` (breaking change — all consumers updated in subsequent stages).
    - Add `SettingsHookEntry` type: `{ event: string; matcher?: string; hooks: HookScript[]; source: HookSource }` for non-plugin hooks from user/project settings.
    - Extend `HookScript` type with `kind: 'command' | 'prompt' | 'agent' | 'http' | 'unknown'` discriminator and optional `rawConfig?: unknown` field. Existing command hooks get `kind: 'command'`; non-command hook types are preserved with `kind` set and `rawConfig` carrying the original entry. Detectors MUST treat non-command `kind` values as `confidence: unknown` (no silent drop). **(Delta 2c — 2026-04-20 post-approval patch.)**
    - Add `settingsHooks: SettingsHookEntry[]` to `SnapshotData` (settings-sourced hooks that are not plugin-associated).
  - `tests/types-v2.test.ts` — type-level tests:
    - Verify `HookSource` enum has exactly 7 values (including `user-managed`).
    - Verify `PluginAgent` has `name` field, no `type` field.
    - Verify `PluginSummary` includes `source` and `enabled`.
    - Verify `HookRegistration` includes `source`.
    - Verify `HookScript` has `kind` field accepting all 5 discriminator values and optional `rawConfig`.
- **Effort:** S
- **`/ccg`:** no
- **Exit criteria:**
  - [ ] `HookSource` enum exports 7 values: `plugin-cache`, `plugin-marketplace`, `user-settings`, `user-settings-local`, `project-settings`, `project-settings-local`, `user-managed`. **(Delta 2a.)**
  - [ ] `PluginAgent` interface has `name: string` field and no `type` field.
  - [ ] `PluginSummary` has `source: HookSource` and `enabled: boolean`.
  - [ ] `HookRegistration` has `source: HookSource`.
  - [ ] `HookScript` has `kind: 'command' | 'prompt' | 'agent' | 'http' | 'unknown'` and optional `rawConfig?: unknown`. **(Delta 2c.)**
  - [ ] `SnapshotData` has `settingsHooks: SettingsHookEntry[]`.
  - [ ] `npx tsc --noEmit` passes (all existing consumers updated with `PluginAgent.type` -> `name` rename — search-and-replace across detectors and tests).
  - [ ] All existing tests pass (rename is a global find-replace; no logic change).
- **Commit:** `[v2-types] HookSource enum, PluginAgent.name rename, source/enabled on PluginSummary` && git push

---

### Stage 1: `[v2-snapshot]` — Full rewrite

- **Goal:** Replace v0.1 snapshot with evidence-driven 5-scope capture that discovers plugins at correct depth, parses all `plugin.json` field variants, reads user/project settings, filters by `enabledPlugins`, and handles YAML frontmatter with block lists.
- **Deliverables:**
  - `src/snapshot.ts` — rewritten with `HookSource` enum consumption, `capturePluginsFromCache()` (3-level walk), `capturePluginsFromMarketplaces()` (marketplace root + nested plugins), `captureUserSettings()`, `captureProjectSettings()`, vendored YAML subset parser, `plugin.json` field normalizers.
  - `src/yaml-frontmatter.ts` — ~80 line subset parser: scalar k:v, inline `[a,b]`, block `- item` lists. Extracted from snapshot for testability.
  - `tests/snapshot-v2/cache-depth.test.ts` — 3-level-deep plugin discovery from cache dir.
  - `tests/snapshot-v2/marketplace-root.test.ts` — marketplace root as plugin root + nested plugins.
  - `tests/snapshot-v2/user-settings.test.ts` — hooks from `settings.json` and `settings.local.json`.
  - `tests/snapshot-v2/project-settings.test.ts` — hooks from project-level settings.
  - `tests/snapshot-v2/enabled-plugins.test.ts` — enabled/disabled tagging.
  - `tests/snapshot-v2/plugin-json-normalize.test.ts` — skills string/array, mcpServers string/object.
  - `tests/yaml-frontmatter.test.ts` — scalar, inline list, block list, mixed, edge cases, **unsupported-construct warning test (R2)**.
- **Effort:** L
- **`/ccg`:** no
- **Exit criteria:**
  - [ ] Fixture mimicking `~/.claude/plugins/cache/omc/oh-my-claudecode/4.11.6/` is discovered at correct depth.
  - [ ] Fixture with `plugins/marketplaces/omc/` is treated as plugin root (hooks, skills, agents captured).
  - [ ] `captureUserSettings()` returns hooks from `settings.json` fixture containing `rtk hook claude` PreToolUse entry.
  - [ ] **(Delta 1)** `captureUserSettings()` probes `~/.claude.json` at home root. If present, its `.mcpServers` field is read and merged into the user-level MCP config surfaced to the MCP detector. If absent, the probe skips silently (no throw, no warning). Fixture: `~/.claude.json` with `{"mcpServers": {"search": {...}}}` results in `search` appearing in the user-level MCP server list.
  - [ ] **(Delta 2a)** `captureUserSettings()` probes a managed-settings path (enterprise-policy location). Hooks discovered there are tagged `source: 'user-managed'` on both `HookRegistration` and `SettingsHookEntry`. If the path is absent, the probe skips silently. Fixture: managed settings file with a `PreToolUse` hook produces a `SettingsHookEntry` whose `source === 'user-managed'`.
  - [ ] **(Delta 2c)** `captureUserSettings()` and `captureProjectSettings()` preserve non-command hook entries (entries whose `type` ∈ `{"prompt", "agent", "http"}`) as `HookScript` with `kind` set to the corresponding discriminator and `rawConfig` carrying the original entry object. Unknown `type` strings yield `kind: 'unknown'` with `rawConfig` preserved. No silent data loss — fixture with one `prompt` hook and one `http` hook in `settings.json` produces two `HookScript` entries with correct `kind` values, each retaining the original config under `rawConfig`.
  - [ ] `captureProjectSettings()` returns hooks from `<cwd>/.claude/settings.json` fixture.
  - [ ] Plugin with `enabledPlugins: {"foo": false}` is tagged `enabled: false` in snapshot.
  - [ ] `plugin.json` with `"skills": "./skills/"` resolves to skill list by walking the directory.
  - [ ] `plugin.json` with `"mcpServers": "./.mcp.json"` resolves to MCP server config by reading the referenced file.
  - [ ] YAML frontmatter with block-list `triggers:\n  - "deep dive"\n  - "deep-dive"` parses to `["deep dive", "deep-dive"]`.
  - [ ] **(R2)** YAML frontmatter with unsupported construct (multiline folded `>`, flow mapping `{a: 1, b: 2}`) produces a parse warning written to stderr, NOT silent data loss. Warning surfaces in collected snapshot metadata as a `parseWarnings: string[]` array on the relevant skill/agent entry.
  - [ ] All captured `PluginSummary` entries have `source: HookSource` set correctly per their discovery path.
  - [ ] All captured `HookRegistration` entries have `source: HookSource` set correctly.
  - [ ] All tests pass via `npx vitest run`.
- **Commit:** `[v2-snapshot] 5-scope capture, 3-level cache walk, YAML parser, plugin.json normalization` && git push

---

### Stage 2: `[v2-detector-hook-matcher]` — Major refactor (was Stage 2, unchanged number)

- **Goal:** Accept hooks from all 5 sources (+ plugin-cache as 6th via `HookSource`). Replace string-equality grouping with matcher-overlap set algebra. Fix mutation classifier to ignore standalone `JSON.stringify`.
- **Deliverables:**
  - `src/detectors/hook-matcher.ts` — refactored to consume `HookSource`-tagged hooks from both `snapshot.plugins[].hookEvents` and `snapshot.settingsHooks`.
  - `src/matcher-overlap.ts` — extracted module: compile matcher to tool set, compute set intersection between two matchers.
  - `tests/detectors/hook-matcher-v2.test.ts` — multi-source hook detection.
  - `tests/matcher-overlap.test.ts` — `*` overlaps everything; `Edit|Write` overlaps `Edit`; `startup|clear|compact` overlaps `*`; disjoint matchers produce no overlap.
- **Effort:** M
- **`/ccg`:** no
- **Exit criteria:**
  - [ ] Fixture with rtk hook (from user settings, matcher `"*"`) + OMC hook (from plugin, matcher `"*"`) both mutating `updatedInput` on PreToolUse produces `confidence: definite` collision.
  - [ ] Fixture with hook matcher `"Edit|Write"` and hook matcher `"Edit"` on same event, both mutating, produces collision.
  - [ ] Fixture with hook matcher `"Bash"` and hook matcher `"Read"` on same event produces no collision (disjoint).
  - [ ] Fixture with `JSON.stringify(updatedInput)` as the ONLY mutation signal in a hook produces no collision (standalone stringify is read-only serialization).
  - [ ] Fixture with `updatedInput.command = ...` produces `definite` collision.
  - [ ] **(C4)** Fixture with user `settings.json` hook with matcher `*` on PreToolUse + plugin hook with matcher `Bash` on PreToolUse, both mutating `updatedInput`, produces a `confidence: definite` hook-matcher collision whose `entities_involved` includes both `user-settings:PreToolUse:*` and `plugin-name:PreToolUse:Bash`.
  - [ ] All tests pass.
- **Commit:** `[v2-detector-hook-matcher] 5-source hooks, matcher overlap algebra, refined mutation classifier` && git push

---

### Stage 3: `[v2-detector-namespace]` — Slash-command, skill-name, subagent-type unified semantics fix (was Stage 3)

- **Goal:** Apply namespace-aware semantics to all 3 identifier detectors in a single stage. Same base name = `info/possible` (not `definite/destructive`). Remove unexecutable fix suggestions. Skill trigger parsing uses new YAML parser. Agent identifier uses `name` field (per Stage 0 rename).
- **Deliverables:**
  - `src/detectors/slash-command.ts` — refactored.
  - `src/detectors/skill-name.ts` — refactored.
  - `src/detectors/subagent-type.ts` — refactored.
  - `tests/detectors/namespace-aware.test.ts` — cross-detector tests for namespace semantics.
  - `tests/detectors/skill-triggers-yaml.test.ts` — block-list triggers parsed correctly.
- **Effort:** M
- **`/ccg`:** no
- **Exit criteria:**
  - [ ] Two enabled plugins both defining command `scan` produces collision with `severity: info, confidence: possible`.
  - [ ] Collision message contains disambiguation guidance: "Use `plugin-a:scan` or `plugin-b:scan`".
  - [ ] No FixSuggestion contains a `# comment` pseudo-command.
  - [ ] No FixSuggestion has `safety_level: "destructive"` for a namespace ambiguity (was wrong in v0.1).
  - [ ] Skill with YAML block-list triggers `["deep dive", "deep-dive"]` produces correct trigger-overlap detection with another skill sharing a trigger keyword.
  - [ ] Agent `name` field (not `type`) is used as the identifier (consuming Stage 0 rename).
  - [ ] All tests pass.
- **Commit:** `[v2-detector-namespace] info/possible for cross-plugin name ambiguity, YAML triggers, no destructive fixes` && git push

---

### Stage 4: `[v2-detector-mcp]` — Extended MCP input sources (was Stage 4)

- **Goal:** MCP detector reads user-level and project-level `.mcp.json` in addition to plugin-declared servers. Plugin `mcpServers` string-path form resolved.
- **Deliverables:**
  - `src/detectors/mcp-identifier.ts` — refactored.
  - `tests/detectors/mcp-v2.test.ts` — user-level + plugin-level server name collision.
- **Effort:** S
- **`/ccg`:** no
- **Exit criteria:**
  - [ ] Fixture with user-level `.mcp.json` defining server `search` and plugin-level `.mcp.json` also defining `search` produces `definite` collision.
  - [ ] Plugin with `"mcpServers": "./.mcp.json"` (string path) resolves and reads the referenced config file.
  - [ ] All tests pass.
- **Commit:** `[v2-detector-mcp] user/project-level MCP sources, string-path resolution` && git push

---

### Stage 5: `[v2-detector-path-binary]` — Executable filter + symlink fix (was Stage 5)

- **Goal:** Filter non-executables from PATH scan. Follow symlinks via `stat` instead of `lstat`. Add realpath loop guard.
- **Deliverables:**
  - `src/detectors/path-binary.ts` — fixed.
  - `tests/detectors/path-binary-v2.test.ts` — symlink, non-executable, loop guard cases.
- **Effort:** S
- **`/ccg`:** no
- **Exit criteria:**
  - [ ] Non-executable file in PATH directory is excluded from scan.
  - [ ] Symlink to a valid executable is included and hashed by target content.
  - [ ] Symlink loop (A -> B -> A) does not cause infinite recursion or crash; produces graceful skip.
  - [ ] All tests pass.
- **Commit:** `[v2-detector-path-binary] executable filter, symlink follow, loop guard` && git push

---

### Stage 6: `[v2-detector-env-agent]` — (unchanged placeholder for any env/agent detector work)

*This stage number is reserved for any additional detector hardening discovered during Stages 1-5. If no work materializes, it is skipped. Renumbered from iteration-1 to keep detector stages contiguous.*

---

### Stage 7a: `[v2-report-base64]` — Base64 wrapper hardening (was half of Stage 6 — R3 split)

- **Goal:** Base64 encode report payload for escape-proof wrapping. Independent from redaction work.
- **Deliverables:**
  - `src/report.ts` — base64 encode/decode.
  - `tests/security/report-wrapper.test.ts` — round-trip with payload containing `</claudit-report>`.
- **Effort:** S
- **`/ccg`:** no
- **Exit criteria:**
  - [ ] `Report.serialize()` produces base64-encoded JSON inside `<claudit-report>` tags.
  - [ ] `Report.parse()` decodes base64 payload and returns valid Report object.
  - [ ] Payload containing literal `</claudit-report>` in a path string round-trips correctly.
  - [ ] All tests pass.
- **Commit:** `[v2-report-base64] escape-proof base64 report wrapper` && git push

---

### Stage 7b: `[v2-redaction-scanmd]` — Redaction + FixSuggestion cleanup + scan.md directives (was other half of Stage 6 — R3 split)

- **Goal:** Secret redaction with 7+ patterns (C2), FixSuggestion audit, scan.md with 8 directives (C3). Independent from base64 work.
- **Deliverables:**
  - `src/pending.ts` — redaction pass before write.
  - `src/redactor.ts` — extracted module with 7+ pattern matchers:
    1. `?token=` / `?key=` / `?secret=` query params
    2. `Authorization: Bearer ...` header values
    3. `GITHUB_TOKEN=` / `*_SECRET=` / `*_KEY=` env-var assignments
    4. `--password` / `--auth-token` flag values
    5. `//registry.npmjs.org/:_authToken=` (npm publish token)
    6. Git credential URLs: `https?://[^:/@\s]+:[^@\s]+@[^\s]+`
    7. `AWS_ACCESS_KEY_ID=AKIA[0-9A-Z]{16}`
    8. SSH key path patterns: `\s-i\s+[\S]+\.pem` and `\s-i\s+[\S]*id_rsa[\S]*`
  - `commands/scan.md` — updated with 8 explicit directives:
    1. Base64 decode the JSON payload from `<claudit-report>` tags.
    2. Map `severity` to visual badges (critical/high/medium/low/info).
    3. Gate fix suggestions by `safety_level` — only offer "run this" for `safe`; show "review manually" for `manual-review`.
    4. For empty command strings with `safety_level: "manual-review"`, describe the manual steps instead of showing a command block.
    5. For collisions with no fix suggestion, explain why (e.g., namespace ambiguity is not fixable).
    6. Group findings by detector category for readability.
    7. If zero collisions found, confirm a clean scan rather than saying nothing.
    8. **(C3)** For collisions with `category: slash-command|skill-name|subagent-type` and `severity: info`, do NOT suggest uninstalling or disabling either plugin. Instead explain the prefix disambiguation syntax (e.g., `/plugin-a:scan` vs `/plugin-b:scan`).
  - `tests/security/command-redaction.test.ts` — per-pattern positive AND negative tests for all 7+ patterns.
  - `tests/fix-suggestion-audit.test.ts` — no FixSuggestion across any detector contains `# comment` or empty command without `manual-review` safety level.
- **Effort:** M
- **`/ccg`:** no
- **Exit criteria:**
  - [ ] Pattern 1: `brew install --token=abc123 foo` redacted to `brew install --token=<redacted> foo`. Negative: `brew install foo` NOT redacted.
  - [ ] Pattern 2: `Authorization: Bearer sk-xxx` redacted to `Authorization: Bearer <redacted>`. Negative: `Authorization: Basic public` NOT redacted (only Bearer with secret-shaped values).
  - [ ] Pattern 3: `GITHUB_TOKEN=ghp_xxx brew install` redacted to `GITHUB_TOKEN=<redacted> brew install`. Negative: `NODE_ENV=production` NOT redacted.
  - [ ] Pattern 4: `--password mysecret` redacted. Negative: `--verbose` NOT redacted.
  - [ ] Pattern 5: `//registry.npmjs.org/:_authToken=npm_xxxx` redacted to `//registry.npmjs.org/:_authToken=<redacted>`. Negative: `//registry.npmjs.org/package-name` NOT redacted.
  - [ ] Pattern 6: `https://user:token123@github.com/repo.git` redacted to `https://<redacted>@github.com/repo.git`. Negative: `https://github.com/repo.git` (no credentials) NOT redacted.
  - [ ] Pattern 7: `AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE` redacted. Negative: `AWS_REGION=us-east-1` NOT redacted.
  - [ ] Pattern 8 (SSH): `ssh -i /home/user/.ssh/id_rsa host` redacted path. `ssh -i key.pem host` redacted path. Negative: `ssh -v host` NOT redacted.
  - [ ] Non-secret content (`brew install ripgrep`) is NOT redacted.
  - [ ] No FixSuggestion in any detector has a `# comment` as its command string.
  - [ ] Every FixSuggestion with empty command string has `safety_level: "manual-review"`.
  - [ ] `commands/scan.md` contains all 8 directives (including C3 namespace disambiguation directive).
  - [ ] All Collision messages use plain language (no `updatedInput` jargon).
  - [ ] All tests pass.
- **Commit:** `[v2-redaction-scanmd] 7+ secret patterns, FixSuggestion cleanup, 8 scan.md directives` && git push

---

### Stage 8: `[v2-e2e-flagship]` — RTK + OMC end-to-end scenario (was Stage 7)

- **Goal:** End-to-end test proving claudit detects its own flagship scenario: rtk user-settings hook + OMC plugin hook interfering on the same matcher.
- **Deliverables:**
  - `tests/e2e/rtk-omc-real.test.ts` — fixture mimicking this machine's `settings.json` with `rtk hook claude` PreToolUse `*` matcher + OMC plugin hook on PreToolUse `*`, both mutating.
  - `tests/e2e/fixtures/rtk-omc/` — realistic directory tree: `settings.json` with hooks + `plugins/cache/omc/oh-my-claudecode/4.11.6/` with hooks.json.
  - `tests/e2e/namespace-ambiguity.test.ts` — two plugins with same command name produces `info/possible`, not `definite/destructive`.
  - `tests/e2e/disabled-plugin.test.ts` — collision involving a disabled plugin produces `possible` confidence.
- **Effort:** M
- **`/ccg`:** no
- **Exit criteria:**
  - [ ] RTK+OMC fixture: Scanner returns collision with `category: hook-matcher`, `confidence: definite`, entities listing both the user-settings rtk hook and the OMC plugin hook.
  - [ ] The collision is detected despite hooks coming from DIFFERENT sources (user-settings vs plugin-cache).
  - [ ] Namespace ambiguity fixture: collision has `severity: info, confidence: possible`.
  - [ ] Disabled plugin fixture: collision has `confidence: possible` with message mentioning disabled status.
  - [ ] Each E2E test uses realistic fixtures (not mocks) exercising the full pipeline: Snapshot -> Scanner -> Report.
  - [ ] All tests pass.
- **Commit:** `[v2-e2e-flagship] rtk+OMC detection, namespace semantics, disabled-plugin handling` && git push

---

### Stage 9: `[v2-ralph-verify]` — Updated verification suite (was Stage 8)

- **Goal:** Automated ralph-verify checks covering v0.2's expanded scope, including v0.1 regression (R4).
- **Deliverables:**
  - `tests/ralph-verify-v2.test.ts` — full verification suite.
- **Effort:** S
- **`/ccg`:** no
- **Exit criteria:**
  - [ ] All 6 criteria (install, namespace, idempotency, multi-source hooks, flagship, **regression**) pass.
  - [ ] See Section 4 for full criteria breakdown.
- **Commit:** `[v2-ralph-verify] expanded verification covering 5-scope hooks, namespace semantics, v0.1 regression` && git push

---

### Stage 10: `[v2-docs-polish]` — Documentation + error messages (was Stage 9)

- **Goal:** Update README, CLAUDE.md, JSDoc. Finalize error messages.
- **Deliverables:**
  - Updated `README.md` with v0.2 architecture (5-scope hook discovery, namespace semantics, base64 report format).
  - Updated `CLAUDE.md` with dev CLI usage.
  - JSDoc on all new/changed public APIs.
  - `src/policies.ts` extended with redaction patterns and namespace severity constants.
- **Effort:** S
- **`/ccg`:** no
- **Exit criteria:**
  - [ ] README documents 5 hook sources (plus plugin-cache as 6th `HookSource` value).
  - [ ] README limitations section matches Section 7 of this plan.
  - [ ] CLAUDE.md includes `npx vitest run` and `npx tsup` as dev commands.
  - [ ] All new public functions have JSDoc.
  - [ ] `npx tsc --noEmit` passes.
- **Commit:** `[v2-docs-polish] documentation, JSDoc, CLAUDE.md dev usage` && git push

---

### Stage 11: `[v2-release]` — Build verification + marketplace update (was Stage 10)

- **Goal:** Clean build, version bump to 0.2.0, marketplace metadata update, smoke test.
- **Deliverables:**
  - `package.json` version `0.2.0`.
  - `marketplace.json` updated.
  - Clean `dist/` build.
- **Effort:** S
- **`/ccg`:** no
- **Exit criteria:**
  - [ ] `npm run build` exits 0, all expected `.mjs` files present in `dist/`.
  - [ ] `npx vitest run` — all tests pass (full suite including v0.1 unchanged + v0.2 new).
  - [ ] `marketplace.json` version matches `package.json`.
  - [ ] `/plugin install <local-path>` succeeds (manual step).
  - [ ] `/claudit scan` produces a report (manual step).
- **Commit:** `[v2-release] v0.2.0 build, marketplace metadata, version bump` && git push

---

## 3. RALPLAN-DR Summary

### Principles (5)

1. **P1: Never mutate** — claudit never modifies user config, settings, or plugin files. Read-only observer. (Carried from v0.1.)
2. **P2: Evidence-driven** — every schema assumption is validated against ground-truth observations from a real 10-plugin install. No hypothetical field shapes. (NEW for v0.2.)
3. **P3: Zero runtime deps** — vendored YAML subset parser, no `js-yaml`, no `node-fetch`, no external packages at runtime. Dev deps (vitest, tsup, typescript) are fine. (Strengthened from v0.1.)
4. **P4: Correct before complete** — fix the 6 CRITICAL/HIGH gaps before adding any new features. No scope creep beyond correctness fixes. (NEW for v0.2.)
5. **P5: Namespace-aware** — plugin identifiers are prefixed by plugin name; same base name is ambiguity (info), not conflict (critical). Fix suggestions must be executable or explicitly marked manual-review. (NEW for v0.2.)

### Decision Drivers (top 3)

1. **Flagship scenario correctness** — if claudit cannot detect rtk + OMC hook interference on this very machine, it is broken. This drives the snapshot rewrite (user-settings hooks) and matcher-overlap algebra.
2. **Ground truth fidelity** — the `cc-schema-ground-truth.md` document catalogs 19 gaps. Every schema assumption in v0.2 must trace to an observed artifact, not a guessed spec.
3. **Minimal blast radius** — 8 of 17 source files are untouched (updated count after removing `types.ts` from UNTOUCHED per R1). Changes target the 9 modules where gaps live. No architecture redesign; the trigger-and-defer pattern, Scanner, and hook I/O are proven correct.

### Viable Options for Contested Decisions

All 5 open questions resolved with clear winners (see Section 1). No decision has 3+ genuinely viable options with no clear winner. Therefore no `/ccg eligible` flags in v0.2.

**Invalidation rationale for alternatives:**

| Decision | Rejected alternative | Why invalidated |
|----------|---------------------|-----------------|
| YAML parser | `js-yaml` runtime dep | Violates P3 (zero runtime deps). Only 3 YAML constructs needed; 80-line parser suffices. |
| Report wrapper | Literal-escape | Fragile against future edge cases. Base64 is unconditionally safe. |
| Redaction policy | Aggressive (all query strings) | Destroys diagnostic context (version pins, package names in URLs). |
| Namespace detector | Skip entirely | Real user friction exists (ambiguous `/name` invocation). Info-level report costs nothing. |
| enabledPlugins | Exclude disabled entirely | Loses preemptive warning about re-enable scenarios. |

---

## 4. ralph-verify Plan (v0.2)

### Criterion 1: Install Verification

**Automated checks (in `tests/ralph-verify-v2.test.ts`):**
- [ ] `hooks/hooks.json` exists at plugin root, parses as valid JSON.
- [ ] `hooks/hooks.json` contains PostToolUse `"*"` and SessionStart entries.
- [ ] Each hook entry has `type: "command"`, non-empty `command`, numeric `timeout`.
- [ ] Hook command paths reference files existing in `dist/hooks/`.
- [ ] `plugin.json` contains `commands` array.
- [ ] `dist/` contains all expected `.mjs` compiled outputs.
- [ ] `npm run build` exits 0.

**Manual steps:**
- [ ] `/plugin install <local-path>` completes.
- [ ] `/claudit scan` appears in available commands and produces output.

### Criterion 2: Namespace Verification

**Automated checks:**
- [ ] Enumerate installed plugins from `~/.claude/plugins/cache/` (3-level walk) AND `~/.claude/plugins/marketplaces/`.
- [ ] For each plugin: parse `plugin.json`, collect commands, skills, agents, MCP server names — handling all field variants (string, array, object).
- [ ] Collect claudit's identifiers: plugin name `"claudit"`, command `"scan"`.
- [ ] Assert zero intersection with other plugins' identifiers.

### Criterion 3: Idempotency

**Automated checks:**
- [ ] Build twice — `dist/` output is byte-identical.
- [ ] `hooks/hooks.json` has exactly 2 event entries after repeated builds.
- [ ] Snapshots directory contains at most 2 files after multiple SessionStart invocations.

### Criterion 4: Multi-Source Hook Detection (NEW for v0.2)

**Automated checks:**
- [ ] Create fixture with hooks in `settings.json` (user-level) AND `plugins/cache/.../hooks/hooks.json` (plugin-level) on the same event+matcher with mutual mutation.
- [ ] Scanner detects the cross-source collision with `confidence: definite`.
- [ ] Collision `entities_involved` lists both sources with their `HookSource` type.
- [ ] Create fixture with same setup but one hook is from a disabled plugin.
- [ ] Collision is reported with `confidence: possible` and message referencing disabled status.

### Criterion 5: Flagship Scenario (NEW for v0.2)

**Automated checks:**
- [ ] Fixture mimicking this machine's actual layout: `settings.json` with `rtk hook claude` + `plugins/cache/omc/oh-my-claudecode/4.11.6/hooks/hooks.json` with OMC PreToolUse `*` hook.
- [ ] Full pipeline (Snapshot -> Scanner -> Report) produces at least one `hook-matcher` collision.
- [ ] Report round-trips through base64 encode/decode without data loss.

### Criterion 6: v0.1 Regression (NEW for v0.2 — R4)

**Automated checks:**
- [ ] v0.1 test files in `tests/` (excluding `tests/*-v2/` and `tests/e2e/`) are enumerated and run as a separate vitest invocation.
- [ ] At least 100 of 109 v0.1 tests pass without modification. This floor of 100 is committed.
- [ ] Any v0.1 tests that fail are documented in a `tests/v0.1-migration-notes.md` file with the reason for each failure (e.g., `PluginAgent.type` rename) and confirmation that the failure is expected from an intentional v0.2 change, not a regression.
- [ ] No v0.1 test is deleted — failing tests are either updated in-place or skipped with `.todo()` and a migration note.

---

## 5. Phase 4 Validation Guardrail (Revised — C1)

v0.1 used internal-only review (Planner/Architect/Critic). The external GPT+Codex+Gemini review caught CRITICALs the internal review missed. v0.2 MUST NOT repeat this.

### Required Phase 4 reviewers (all mandatory):

| Reviewer | Role | Invocation |
|----------|------|------------|
| Architect | Structural soundness, interface consistency | Internal (ralplan iteration) |
| Critic | Correctness gaps, exit criteria completeness | Internal (ralplan iteration) |
| Code-reviewer | Implementation quality, test coverage | Internal (`/oh-my-claudecode:verify`) |
| Codex | External adversarial review — schema assumptions, edge cases | `omc ask codex` |
| Gemini | External adversarial review — false negatives, matcher algebra | `omc ask gemini` |

### Pre-check (C1):

Before invoking external reviewers, run the following pre-check. If it fails, Phase 4 is BLOCKED:

```bash
# Pre-check: verify external reviewer CLIs are available
CODEX_AVAILABLE=false
GEMINI_AVAILABLE=false

which codex >/dev/null 2>&1 && CODEX_AVAILABLE=true
which gemini >/dev/null 2>&1 && GEMINI_AVAILABLE=true

# Fallback: omc ask routes through omc if direct CLIs unavailable
if [ "$CODEX_AVAILABLE" = false ] || [ "$GEMINI_AVAILABLE" = false ]; then
  which omc >/dev/null 2>&1 || {
    echo "BLOCKED: Neither direct CLI (codex/gemini) nor omc found."
    echo "Install codex: npm install -g @openai/codex"
    echo "Install omc: claude plugin install oh-my-claudecode"
    echo "Phase 4 cannot proceed. Manual human review required."
    exit 1
  }
fi
```

### Concrete prompt templates (C1):

**Codex reviewer prompt:**

```
You are reviewing claudit v0.2, a Claude Code plugin collision detector.

Review these files against the ground-truth document:
- src/snapshot.ts (plugin discovery, settings capture, YAML parsing)
- src/detectors/hook-matcher.ts (multi-source hook collision detection)
- src/matcher-overlap.ts (matcher set algebra)
- src/types.ts (HookSource enum, PluginSummary, HookRegistration)
- src/redactor.ts (secret pattern redaction)

Ground truth: .omc/research/cc-schema-ground-truth.md

For each file, answer:
1. Is every schema assumption backed by observed evidence in ground truth?
2. Are there field shapes, directory layouts, or hook event names assumed but not documented?
3. What false-negative scenarios does the test suite NOT cover?

Output format: list findings as CRITICAL / MAJOR / MINOR with file:line references.
```

**Gemini reviewer prompt:**

```
You are reviewing claudit v0.2, a Claude Code plugin collision detector.

Review these files for correctness:
- src/matcher-overlap.ts (set algebra for hook matcher overlap)
- src/detectors/hook-matcher.ts (cross-source collision detection)
- src/redactor.ts (conservative secret redaction, 7+ patterns)
- tests/e2e/rtk-omc-real.test.ts (flagship scenario test)
- commands/scan.md (8 directives for Claude consumption)

Focus areas:
1. Matcher algebra: does `*` correctly overlap with every specific matcher? Does `Edit|Write` correctly overlap with `Edit` but not `Bash`?
2. Cross-source detection: can a user-settings hook and a plugin hook on overlapping matchers produce a false negative?
3. Redaction: do the 7+ patterns have false-positive or false-negative risks? Are the regex patterns correct?
4. scan.md: will Claude follow directive 8 (namespace disambiguation) correctly?

Output format: list findings as CRITICAL / MAJOR / MINOR with file references.
```

### Fallback rule (C1):

**If either external reviewer is unavailable (CLI not installed, API key not configured, or command exits non-zero before producing output), Phase 4 is BLOCKED. The stage does not skip. The executor must either:**
1. Install the missing CLI and retry, OR
2. Perform manual human review covering the same scope as the missing reviewer's prompt template, documenting findings in `.omc/plans/v0.2/manual-review-notes.md`.

**There is no silent skip. No automatic fallback to "internal review only."**

### Invocation protocol:

1. After Stage 8 (e2e-flagship) passes all tests, run pre-check.
2. Run Codex and Gemini reviews IN PARALLEL using the prompt templates above.
3. Any CRITICAL finding from external review blocks Stage 9+. Fix and re-run.
4. MAJOR findings: fix if feasible within v0.2 scope; else document in Limitations section with rationale.
5. INFO findings: log to `.omc/plans/v0.2/external-review-notes.md` for v0.3 consideration.

---

## 6. ADR (Architecture Decision Record)

### Decision

Rewrite claudit's snapshot module and refactor 4 of 6 detectors to match empirically observed Claude Code plugin schema, while preserving the proven trigger-and-defer architecture, Scanner orchestrator, and hook I/O layer from v0.1.

### Drivers

1. **Correctness** — v0.1's flagship scenario (rtk + OMC) goes undetected because user-level hooks in `settings.json` are not scanned. This is the project's reason for existing; getting it wrong is a ship-stopper.
2. **Evidence alignment** — ground-truth audit revealed 19 gaps between v0.1's assumptions and actual Claude Code schema. Fixing these is non-negotiable for a security/conflict-detection tool.
3. **Minimal disruption** — 8 of 17 source files are unchanged (updated from 9 per R1). The architecture (trigger-and-defer, Promise.allSettled scanning, hook I/O convention) proved correct in v0.1 and carries forward intact.

### Alternatives Considered

| Alternative | Why Rejected |
|-------------|-------------|
| **Keep v0.1 unchanged + patch** | Patching cannot fix the snapshot module — the hook source model, plugin cache depth, and YAML parsing are architectural to snapshot.ts. Patches would be larger than a clean rewrite and harder to test. |
| **Full rewrite (all modules)** | Unnecessary. Scanner, hook I/O, types, pending, policies are proven correct. Rewriting them adds risk and work with no correctness benefit. |
| **Add `js-yaml` runtime dependency** | Violates P3 (zero runtime deps). The YAML subset needed is small enough to vendor safely. |
| **Skip namespace semantics fix, keep `definite/destructive`** | Produces wrong advice. A user following claudit's "uninstall plugin-b" fix for a namespace ambiguity would lose a working plugin. Correctness of advice is as important as correctness of detection. |

### Why Chosen

Targeted rewrite of snapshot + 4 detectors fixes all 6 CRITICAL/HIGH gaps while preserving the proven 8-module foundation. The 11-stage pipeline (Stage 0 + Stages 1-11, with Stage 6 reserved) is proportionate. Each stage has binary exit criteria verifiable by `vitest run`. External CCG review at Stage 8 prevents the blind-spot recurrence from v0.1.

### Consequences

- **Positive:** Flagship scenario detected. All 19 ground-truth gaps addressed. Base64 report wrapper eliminates XML-injection risk. Namespace-aware detectors produce correct advice. External review gate prevents internal blind spots. 7+ redaction patterns cover real-world secret formats.
- **Negative:** Snapshot rewrite is the largest single stage (Effort: L). Vendored YAML parser is a maintenance surface (but ~80 lines, with parse-warning on unsupported constructs per R2). Base64 encoding makes raw report output opaque (acceptable: output is machine-consumed). `PluginAgent.type` -> `name` rename is a breaking change requiring global find-replace.
- **Neutral:** v0.1's 109 tests continue to pass (at least 100 without modification per R4 regression criterion). New tests add ~70-90 test cases. Total test count expected ~180-200.

### Follow-ups

- v0.3: Watch-mode / in-session notification if CC adds background execution.
- v0.3: Windows/WSL support (PATH separator, shell detection).
- v0.3: npm + GitHub release distribution.
- v0.3: Matcher overlap grammar — currently handles `*`, single name, pipe-OR `A|B`. Future: regex subsets, glob patterns if CC adopts them.
- v0.3: `.mcp.json` path resolution for `~/.claude/.mcp.json` vs `settings.json.mcpServers` variance across CC versions.

---

## 7. Limitations

### Carried from v0.1

1. **Static analysis scope boundary** — claudit reads configuration files at rest. It does not execute hook scripts, intercept live hook chains, access CC's internal plugin resolution logic, or observe runtime environment variables beyond `process.env` at scan time.

2. **False-negative policy** — the following may produce false negatives:
   - Hook execution ordering across plugins (composition conflicts invisible statically).
   - Dynamic variable expansion (`$()`, template literals, computed `require()` paths).
   - Hook merge/de-duplication rules applied by the CC runtime.
   - Post-install lazy plugin registration.

3. **False-positive policy** — same matcher with multiple hooks is NOT a collision. Only confirmed mutual input mutation on the same event+matcher is reported. This minimizes noise.

4. **4KB analysis ceiling** — hook script content beyond 4KB is truncated. Mutation patterns after the cutoff produce `confidence: possible` (not missed silently).

### New for v0.2

5. **Matcher overlap grammar subset** — v0.2 handles `*` (wildcard), single tool name (`Bash`), and pipe-OR lists (`Edit|Write`). It does NOT handle:
   - Full regex matchers (if CC ever supports `Edit.*` patterns).
   - Glob matchers (if CC ever supports `Edit*`).
   - Negation matchers (if CC ever supports `!Bash`).
   If CC's matcher grammar expands beyond pipe-OR, claudit's overlap detection will produce false negatives for the new patterns. The set-algebra module (`matcher-overlap.ts`) is designed to be extended.

6. **`.mcp.json` path resolution caveats** — user-level MCP config location varies by CC version (`~/.claude/.mcp.json` vs `settings.json.mcpServers`). v0.2 probes both. If a future CC version moves MCP config elsewhere, claudit will miss those servers until updated.

7. **Namespace-aware semantics assumptions** — v0.2 assumes CC always prefixes identifiers with `plugin:name` and that unprefixed invocation is ambiguous but not broken. If CC changes its resolution strategy (e.g., first-installed wins, or errors on ambiguity), claudit's severity classification would need updating.

8. **Vendored YAML parser scope** — the subset parser handles scalar `key: value`, inline lists `[a, b]`, and block lists (`- item`). It does NOT handle: anchors/aliases, merge keys, multiline folded/literal strings, flow mappings, or nested block structures. Skill/agent frontmatter using these constructs will produce parse warnings (written to stderr and surfaced in snapshot metadata), not silent failures. **(R2 hardened.)**

9. **`enabledPlugins` map completeness** — v0.2 trusts `settings.json.enabledPlugins` as the source of truth. If a plugin is installed but not listed in `enabledPlugins` (neither `true` nor `false`), it is treated as `enabled: unknown` and scanned at full confidence. This is conservative (may over-report) but safe.

10. **`PluginAgent.type` -> `name` migration** — v0.2 renames `PluginAgent.type` to `PluginAgent.name` to match ground-truth agent frontmatter schema. Any downstream code referencing `PluginAgent.type` will get a compile error. This is intentional (breaking change, caught by `tsc`).

11. **Cross-source collision entity naming** — `entities_involved` strings use the format `source:event:matcher` (e.g., `user-settings:PreToolUse:*`). This format is internal to claudit and not part of any CC schema.

12. **Session-start.ts stability** — Snapshot derives user-settings, project-settings, and enabledPlugins internally from `globalRoot` and `projectRoot`. The `session-start.ts` call site passes only these two paths and does not need modification. If a future version requires additional explicit paths (e.g., custom settings location), `session-start.ts` would need updating. **(R5 documented.)**

13. **Redaction pattern coverage** — the 7+ redaction patterns are non-exhaustive. Unknown secret formats (custom API keys with non-standard naming, encoded credentials, secrets in non-standard flag positions) pass through unredacted. The pattern list is extensible via `policies.ts`. **(C2 acknowledged.)**

---

## 8. Effort Summary

| Stage | Token | Effort | /ccg |
|-------|-------|--------|------|
| 0 | `[v2-types]` | S | no |
| 1 | `[v2-snapshot]` | L | no |
| 2 | `[v2-detector-hook-matcher]` | M | no |
| 3 | `[v2-detector-namespace]` | M | no |
| 4 | `[v2-detector-mcp]` | S | no |
| 5 | `[v2-detector-path-binary]` | S | no |
| 6 | (reserved) | — | — |
| 7a | `[v2-report-base64]` | S | no |
| 7b | `[v2-redaction-scanmd]` | M | no |
| 8 | `[v2-e2e-flagship]` | M | no |
| 9 | `[v2-ralph-verify]` | S | no |
| 10 | `[v2-docs-polish]` | S | no |
| 11 | `[v2-release]` | S | no |

**Total: 12 stages** (11 active + 1 reserved). 1L + 4M + 6S.
**Estimated new/modified test files:** ~17. **Estimated new test cases:** ~80-90.
**Estimated total test count after v0.2:** ~190-200 (109 existing, at least 100 passing unmodified per R4, + ~80-90 new).

No `/ccg` flags. All open questions resolved with clear defaults (see Section 1).
