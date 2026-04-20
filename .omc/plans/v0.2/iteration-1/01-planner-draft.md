# claudit v0.2 — Implementation Plan (Iteration 1 Draft)

**Date:** 2026-04-20
**Basis:** Ground truth audit (`cc-schema-ground-truth.md`), v0.2 redesign plan, v0.1 consensus outcome
**Motivation:** v0.1 shipped 109 passing tests but has 6 CRITICAL/HIGH correctness gaps that cause its flagship scenario (rtk + OMC hook interference) to go undetected.

---

## 0. Changelog vs v0.1

### Modules UNTOUCHED (no code changes)

| Module | Rationale |
|--------|-----------|
| `src/types.ts` | Collision/Report/FixSuggestion schema unchanged. New fields added additively (no breaking changes). |
| `src/detector.ts` | Async `Detector` interface unchanged. |
| `src/scanner.ts` | `Promise.allSettled` + per-detector timeout orchestration unchanged. |
| `src/hook-io.ts` | stdin parse / stdout builder unchanged. |
| `src/policies.ts` | Constants file. Extended but not rewritten. |
| `src/hooks/post-tool-use.ts` | Trigger logic unchanged. Redaction added as a wrapper around existing pending write (additive, not rewrite). |
| `src/hooks/session-start.ts` | Consume-markers + diff + scan pipeline unchanged. |

### Modules REWRITTEN (substantial logic replacement)

| Module | What changes | Gap(s) addressed |
|--------|-------------|-----------------|
| `src/snapshot.ts` | Full rewrite: 5-scope hook source enum, 3-level-deep plugin cache walk, marketplace root walk, user/project settings capture, `enabledPlugins` filter, YAML frontmatter parser, `plugin.json` field normalization (skills/mcpServers string forms). | #1 (depth), #2 (hook sources), #3 (skills string), #4 (mcpServers string), #5 (YAML triggers), #8 (enabledPlugins) |
| `src/detectors/hook-matcher.ts` | Major refactor: accept hooks from all 5 sources, matcher-overlap set algebra (not string equality), drop standalone `JSON.stringify` as mutation signal. | #2 (hook sources), #6 (matcher grouping) |
| `src/detectors/slash-command.ts` | Semantics fix: same base name across enabled plugins = `possible/info` (not `definite/destructive`). Remove destructive fix suggestions. | #7 (namespace) |
| `src/detectors/skill-name.ts` | Same namespace semantics fix + YAML block-list trigger parsing delegated to snapshot's new parser. | #5 (triggers), #7 (namespace) |
| `src/detectors/subagent-type.ts` | Same namespace semantics fix. | #7 (namespace) |

### Modules HARDENED (targeted fixes, not rewrite)

| Module | Fix |
|--------|-----|
| `src/detectors/mcp-identifier.ts` | Extend input to include user-level `.mcp.json` and project-level `.mcp.json`. Plugin `mcpServers` string-path resolution. |
| `src/detectors/path-binary.ts` | Filter non-executables (`mode & 0o111`). Follow symlinks with `stat` (not `lstat`). Realpath loop guard. |
| `src/report.ts` | Base64 encode JSON payload inside `<claudit-report>` wrapper. Parser decodes on read. |
| `src/pending.ts` | Redaction pass before disk write: bearer tokens, Authorization headers, env-var assignment values. |
| `commands/scan.md` | Add explicit directives: base64 decode, severity badges, fix safety-level gating, empty-command guidance. |
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

**Rationale:** Aggressive redaction (all query string values) would redact harmless version pins (`?v=3.2.1`), package names in URLs, and diagnostic info that helps the scan report explain what was installed. Conservative policy targets 4 specific patterns:
1. `?token=...` / `?key=...` / `?secret=...` query params
2. `Authorization: Bearer ...` in curl `-H` args
3. `GITHUB_TOKEN=...` / `*_SECRET=...` / `*_KEY=...` env-var assignments
4. `--password` / `--auth-token` flag values

This catches real secrets without destroying useful context. Extensible via `policies.ts` pattern list.

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

### Stage 1: `[v2-snapshot]` — Full rewrite

- **Goal:** Replace v0.1 snapshot with evidence-driven 5-scope capture that discovers plugins at correct depth, parses all `plugin.json` field variants, reads user/project settings, filters by `enabledPlugins`, and handles YAML frontmatter with block lists.
- **Deliverables:**
  - `src/snapshot.ts` — rewritten with `HookSource` enum, `capturePluginsFromCache()` (3-level walk), `capturePluginsFromMarketplaces()` (marketplace root + nested plugins), `captureUserSettings()`, `captureProjectSettings()`, vendored YAML subset parser, `plugin.json` field normalizers.
  - `src/yaml-frontmatter.ts` — ~80 line subset parser: scalar k:v, inline `[a,b]`, block `- item` lists. Extracted from snapshot for testability.
  - `tests/snapshot-v2/cache-depth.test.ts` — 3-level-deep plugin discovery from cache dir.
  - `tests/snapshot-v2/marketplace-root.test.ts` — marketplace root as plugin root + nested plugins.
  - `tests/snapshot-v2/user-settings.test.ts` — hooks from `settings.json` and `settings.local.json`.
  - `tests/snapshot-v2/project-settings.test.ts` — hooks from project-level settings.
  - `tests/snapshot-v2/enabled-plugins.test.ts` — enabled/disabled tagging.
  - `tests/snapshot-v2/plugin-json-normalize.test.ts` — skills string/array, mcpServers string/object.
  - `tests/yaml-frontmatter.test.ts` — scalar, inline list, block list, mixed, edge cases.
- **Effort:** L
- **`/ccg`:** no
- **Exit criteria:**
  - [ ] Fixture mimicking `~/.claude/plugins/cache/omc/oh-my-claudecode/4.11.6/` is discovered at correct depth.
  - [ ] Fixture with `plugins/marketplaces/omc/` is treated as plugin root (hooks, skills, agents captured).
  - [ ] `captureUserSettings()` returns hooks from `settings.json` fixture containing `rtk hook claude` PreToolUse entry.
  - [ ] `captureProjectSettings()` returns hooks from `<cwd>/.claude/settings.json` fixture.
  - [ ] Plugin with `enabledPlugins: {"foo": false}` is tagged `enabled: false` in snapshot.
  - [ ] `plugin.json` with `"skills": "./skills/"` resolves to skill list by walking the directory.
  - [ ] `plugin.json` with `"mcpServers": "./.mcp.json"` resolves to MCP server config by reading the referenced file.
  - [ ] YAML frontmatter with block-list `triggers:\n  - "deep dive"\n  - "deep-dive"` parses to `["deep dive", "deep-dive"]`.
  - [ ] All tests pass via `npx vitest run`.
- **Commit:** `[v2-snapshot] 5-scope capture, 3-level cache walk, YAML parser, plugin.json normalization` && git push

---

### Stage 2: `[v2-detector-hook-matcher]` — Major refactor

- **Goal:** Accept hooks from all 5 sources. Replace string-equality grouping with matcher-overlap set algebra. Fix mutation classifier to ignore standalone `JSON.stringify`.
- **Deliverables:**
  - `src/detectors/hook-matcher.ts` — refactored.
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
  - [ ] All tests pass.
- **Commit:** `[v2-detector-hook-matcher] 5-source hooks, matcher overlap algebra, refined mutation classifier` && git push

---

### Stage 3: `[v2-detector-namespace]` — Slash-command, skill-name, subagent-type unified semantics fix

- **Goal:** Apply namespace-aware semantics to all 3 identifier detectors in a single stage. Same base name = `info/possible` (not `definite/destructive`). Remove unexecutable fix suggestions. Skill trigger parsing uses new YAML parser.
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
  - [ ] Agent `name` field (not `type`) is used as the identifier.
  - [ ] All tests pass.
- **Commit:** `[v2-detector-namespace] info/possible for cross-plugin name ambiguity, YAML triggers, no destructive fixes` && git push

---

### Stage 4: `[v2-detector-mcp]` — Extended MCP input sources

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

### Stage 5: `[v2-detector-path-binary]` — Executable filter + symlink fix

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

### Stage 6: `[v2-report-hardening]` — Base64 wrapper + redaction + FixSuggestion cleanup

- **Goal:** Base64 encode report payload. Add pending marker redaction. Clean up all FixSuggestion entries across detectors. Polish Collision messages.
- **Deliverables:**
  - `src/report.ts` — base64 encode/decode.
  - `src/pending.ts` — redaction pass before write.
  - `src/redactor.ts` — extracted module with 4 pattern matchers.
  - `commands/scan.md` — updated with 7 explicit directives (base64 decode, severity badges, fix safety gating, empty-command handling).
  - `tests/security/report-wrapper.test.ts` — round-trip with payload containing `</claudit-report>`.
  - `tests/security/command-redaction.test.ts` — 4 secret patterns redacted, non-secret content preserved.
  - `tests/fix-suggestion-audit.test.ts` — no FixSuggestion across any detector contains `# comment` or empty command without `manual-review` safety level.
- **Effort:** M
- **`/ccg`:** no
- **Exit criteria:**
  - [ ] `Report.serialize()` produces base64-encoded JSON inside `<claudit-report>` tags.
  - [ ] `Report.parse()` decodes base64 payload and returns valid Report object.
  - [ ] Payload containing literal `</claudit-report>` in a path string round-trips correctly.
  - [ ] Pending marker for `brew install --token=abc123 foo` stores `brew install --token=<redacted> foo`.
  - [ ] `Authorization: Bearer sk-xxx` in a curl command is redacted to `Authorization: Bearer <redacted>`.
  - [ ] `GITHUB_TOKEN=ghp_xxx brew install` is redacted to `GITHUB_TOKEN=<redacted> brew install`.
  - [ ] Non-secret content (`brew install ripgrep`) is NOT redacted.
  - [ ] No FixSuggestion in any detector has a `# comment` as its command string.
  - [ ] Every FixSuggestion with empty command string has `safety_level: "manual-review"`.
  - [ ] `commands/scan.md` contains all 7 directives.
  - [ ] All Collision messages use plain language (no `updatedInput` jargon).
  - [ ] All tests pass.
- **Commit:** `[v2-report-hardening] base64 wrapper, secret redaction, FixSuggestion cleanup, scan.md directives` && git push

---

### Stage 7: `[v2-e2e-flagship]` — RTK + OMC end-to-end scenario

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
  - [ ] The collision is detected despite hooks coming from DIFFERENT sources (user-settings vs plugin).
  - [ ] Namespace ambiguity fixture: collision has `severity: info, confidence: possible`.
  - [ ] Disabled plugin fixture: collision has `confidence: possible` with message mentioning disabled status.
  - [ ] Each E2E test uses realistic fixtures (not mocks) exercising the full pipeline: Snapshot -> Scanner -> Report.
  - [ ] All tests pass.
- **Commit:** `[v2-e2e-flagship] rtk+OMC detection, namespace semantics, disabled-plugin handling` && git push

---

### Stage 8: `[v2-ralph-verify]` — Updated verification suite

- **Goal:** Automated ralph-verify checks covering v0.2's expanded scope.
- **Deliverables:**
  - `tests/ralph-verify-v2.test.ts` — full verification suite.
- **Effort:** S
- **`/ccg`:** no
- **Exit criteria:**
  - [ ] All 4 criteria (install, namespace, idempotency, new: multi-source hooks) pass.
  - [ ] See Section 4 for full criteria breakdown.
- **Commit:** `[v2-ralph-verify] expanded verification covering 5-scope hooks and namespace semantics` && git push

---

### Stage 9: `[v2-docs-polish]` — Documentation + error messages

- **Goal:** Update README, CLAUDE.md, JSDoc. Finalize error messages.
- **Deliverables:**
  - Updated `README.md` with v0.2 architecture (5-scope hook discovery, namespace semantics, base64 report format).
  - Updated `CLAUDE.md` with dev CLI usage.
  - JSDoc on all new/changed public APIs.
  - `src/policies.ts` extended with redaction patterns and namespace severity constants.
- **Effort:** S
- **`/ccg`:** no
- **Exit criteria:**
  - [ ] README documents 5 hook sources.
  - [ ] README limitations section matches Section 7 of this plan.
  - [ ] CLAUDE.md includes `npx vitest run` and `npx tsup` as dev commands.
  - [ ] All new public functions have JSDoc.
  - [ ] `npx tsc --noEmit` passes.
- **Commit:** `[v2-docs-polish] documentation, JSDoc, CLAUDE.md dev usage` && git push

---

### Stage 10: `[v2-release]` — Build verification + marketplace update

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
3. **Minimal blast radius** — 9 of 17 source files are untouched. Changes target the 8 modules where gaps live. No architecture redesign; the trigger-and-defer pattern, Scanner, and hook I/O are proven correct.

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

---

## 5. Phase 4 Validation Guardrail

v0.1 used internal-only review (Planner/Architect/Critic). The external GPT+Codex+Gemini review caught CRITICALs the internal review missed (hook source scope, plugin cache depth, namespace semantics). v0.2 MUST NOT repeat this.

### Required Phase 4 reviewers (all mandatory):

| Reviewer | Role | Invocation |
|----------|------|------------|
| Architect | Structural soundness, interface consistency | Internal (ralplan iteration) |
| Critic | Correctness gaps, exit criteria completeness | Internal (ralplan iteration) |
| Code-reviewer | Implementation quality, test coverage | Internal (`/oh-my-claudecode:verify`) |
| Codex | External adversarial review — schema assumptions, edge cases | `omc ask codex` |
| Gemini | External adversarial review — false negatives, matcher algebra | `omc ask gemini` |

### Invocation protocol:

1. After Stage 7 (e2e-flagship) passes all tests, run Codex and Gemini reviews IN PARALLEL.
2. Prompt for both: "Review claudit v0.2's snapshot.ts, hook-matcher.ts, and matcher-overlap.ts against the ground-truth document. Identify any schema assumption that is not backed by observed evidence. Identify any false-negative scenario the test suite does not cover."
3. Any CRITICAL finding from external review blocks Stage 8+. Fix and re-run.
4. MAJOR findings: fix if feasible within v0.2 scope; else document in Limitations section with rationale.
5. INFO findings: log to `.omc/plans/v0.2/external-review-notes.md` for v0.3 consideration.

---

## 6. ADR (Architecture Decision Record)

### Decision

Rewrite claudit's snapshot module and refactor 4 of 6 detectors to match empirically observed Claude Code plugin schema, while preserving the proven trigger-and-defer architecture, Scanner orchestrator, and hook I/O layer from v0.1.

### Drivers

1. **Correctness** — v0.1's flagship scenario (rtk + OMC) goes undetected because user-level hooks in `settings.json` are not scanned. This is the project's reason for existing; getting it wrong is a ship-stopper.
2. **Evidence alignment** — ground-truth audit revealed 19 gaps between v0.1's assumptions and actual Claude Code schema. Fixing these is non-negotiable for a security/conflict-detection tool.
3. **Minimal disruption** — 9 of 17 source files are unchanged. The architecture (trigger-and-defer, Promise.allSettled scanning, hook I/O convention) proved correct in v0.1 and carries forward intact.

### Alternatives Considered

| Alternative | Why Rejected |
|-------------|-------------|
| **Keep v0.1 unchanged + patch** | Patching cannot fix the snapshot module — the hook source model, plugin cache depth, and YAML parsing are architectural to snapshot.ts. Patches would be larger than a clean rewrite and harder to test. |
| **Full rewrite (all modules)** | Unnecessary. Scanner, hook I/O, types, pending, policies are proven correct. Rewriting them adds risk and work with no correctness benefit. |
| **Add `js-yaml` runtime dependency** | Violates P3 (zero runtime deps). The YAML subset needed is small enough to vendor safely. |
| **Skip namespace semantics fix, keep `definite/destructive`** | Produces wrong advice. A user following claudit's "uninstall plugin-b" fix for a namespace ambiguity would lose a working plugin. Correctness of advice is as important as correctness of detection. |

### Why Chosen

Targeted rewrite of snapshot + 4 detectors fixes all 6 CRITICAL/HIGH gaps while preserving the proven 9-module foundation. The 10-stage pipeline is 37% smaller than v0.1's 16 stages because scaffold/types/scanner/hook-io/pending are already built. Each stage has binary exit criteria verifiable by `vitest run`. External CCG review at Stage 7 prevents the blind-spot recurrence from v0.1.

### Consequences

- **Positive:** Flagship scenario detected. All 19 ground-truth gaps addressed. Base64 report wrapper eliminates XML-injection risk. Namespace-aware detectors produce correct advice. External review gate prevents internal blind spots.
- **Negative:** Snapshot rewrite is the largest single stage (Effort: L). Vendored YAML parser is a maintenance surface (but ~80 lines). Base64 encoding makes raw report output opaque (acceptable: output is machine-consumed).
- **Neutral:** v0.1's 109 tests continue to pass (untouched modules). New tests add ~60-80 test cases. Total test count expected ~170-190.

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

8. **Vendored YAML parser scope** — the subset parser handles scalar `key: value`, inline lists `[a, b]`, and block lists (`- item`). It does NOT handle: anchors/aliases, merge keys, multiline folded/literal strings, flow mappings, or nested block structures. Skill/agent frontmatter using these constructs will produce parse warnings, not silent failures.

9. **`enabledPlugins` map completeness** — v0.2 trusts `settings.json.enabledPlugins` as the source of truth. If a plugin is installed but not listed in `enabledPlugins` (neither `true` nor `false`), it is treated as `enabled: unknown` and scanned at full confidence. This is conservative (may over-report) but safe.

---

## 8. Effort Summary

| Stage | Token | Effort | /ccg |
|-------|-------|--------|------|
| 1 | `[v2-snapshot]` | L | no |
| 2 | `[v2-detector-hook-matcher]` | M | no |
| 3 | `[v2-detector-namespace]` | M | no |
| 4 | `[v2-detector-mcp]` | S | no |
| 5 | `[v2-detector-path-binary]` | S | no |
| 6 | `[v2-report-hardening]` | M | no |
| 7 | `[v2-e2e-flagship]` | M | no |
| 8 | `[v2-ralph-verify]` | S | no |
| 9 | `[v2-docs-polish]` | S | no |
| 10 | `[v2-release]` | S | no |

**Total: 10 stages** (vs v0.1's 16). 1L + 4M + 5S.
**Estimated new/modified test files:** ~15. **Estimated new test cases:** ~70-80.
**Estimated total test count after v0.2:** ~180 (109 existing + ~70 new).

No `/ccg` flags. All open questions resolved with clear defaults (see Section 1).
