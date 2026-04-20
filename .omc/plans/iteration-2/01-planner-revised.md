# claudit v0.1 — Implementation Plan (Iteration 2 Revised)

## 0. Changelog vs Iteration 1

**R1 (Architect-1 / Critic-CRITICAL): Stage 11 split into trigger + deferred scan.** The original Stage 11 attempted full content-aware scanning inside the PostToolUse hook's 200ms budget — physically impossible for 20-50 file reads. Stage 11 now performs only regex matching on hook stdin + writes a pending marker file. A new Stage 12 (`hook-session-start`) consumes pending markers and runs the deferred full scan under the 500ms SessionStart budget. This resolves the P3/P5 tension completely.

**R2 (Architect-2 / Critic-MAJOR-1): Hook stdout shape resolved by ecosystem convention.** Iteration 1 said "JSON + XML wrapper, /ccg required" — contradictory. Real convention discovered via ecosystem grep: `{"continue": true, "hookSpecificOutput": {"hookEventName": "...", "additionalContext": "..."}}`. claudit wraps its report XML inside the `additionalContext` string. This is no longer a /ccg decision; convention adopted directly.

**R3 (Architect-3 / Critic-5-confirmed): Snapshot scope expanded.** `projectRoot` parameter added to Snapshot constructor. Snapshot now covers `~/.claude/` (global) + project-level `.claude/` (when present). Stage 3 exit criteria updated.

**R4 (Architect-4): Scanner uses Promise.allSettled + per-detector timeout.** Stage 10 now specifies `Promise.allSettled()` with configurable per-detector timeout (default 100ms). Timeout or thrown error produces `Collision{category: "internal-error", confidence: "unknown", message: "<detector-name> timed out"}`.

**R5 (Architect-5 / Critic-6-partial): /claudit scan registered as command.** Stage 13 uses `plugin.json "commands": [...]` array. All "skill" nomenclature removed. Confirmed by both Architect and Critic — no /ccg needed.

**R6 (Architect-6 / Critic-6): Stage 1 scaffold deliverables made explicit.** Now lists: package.json (with devDeps), tsconfig.json, plugin.json (with commands array), hooks/hooks.json skeleton, build toolchain (tsup), directory structure, .gitignore. Build outputs `.mjs` pre-compiled hooks.

**R7 (Architect-7): Commit + push lines added to every stage.** Each stage now ends with `Commit: [stage-token] <summary> && git push`. No AI attribution in messages.

**R8 (Architect-8 / Critic-5): Open Q4/Q5/Q7 contradictions resolved.** Q4 (report format): resolved — convention adopted, no /ccg. Q5 (detector signature): resolved — async with `Promise.allSettled`, no /ccg. Q7 (install regex): resolved — initial set defined, extensible config, no /ccg.

**R9 (Critic-1 / MAJOR-4): Pending marker design specified.** Location: `~/.claude/claudit/pending/`. Format: JSON file per event. Cleanup: consumed and deleted by SessionStart hook on successful scan. Batching: rapid installs produce separate files, SessionStart merges all pending entries into a single scan pass. This remains a genuinely contested design (3+ options for location/lifecycle) so `/ccg eligible` flag is preserved, but a concrete default is specified so executor is not blocked.

**R10 (Critic-2): Hook stdin parsing added.** Stage 11 now specifies that PostToolUse receives tool input+output on stdin as JSON. claudit parses `stdin.tool_input.command` to extract the Bash command string for regex matching. The exact stdin shape claudit expects is documented.

**R11 (Critic-3): Confidence field added to Collision.** `confidence: 'definite' | 'possible' | 'unknown'` added to Collision schema in Stage 2. `definite` = exact name collision or confirmed mutation. `possible` = dynamic content prevents certainty (unresolved env vars, complex hook logic). `unknown` = detector error or timeout.

**R12 (Critic-4): Binary exit criteria added to all stages.** Every stage (3-10) now has explicit binary assertions, not "works correctly" language.

**R13 (Critic-7): ralph-verify revised.** Install test verifies hooks.json at convention path (`hooks/hooks.json` auto-discovered by CC, NOT declared in plugin.json). Namespace test programmatically enumerates ALL installed plugin identifiers (commands + skills + agents + MCP server names) from every installed plugin's plugin.json, not grep for a single string.

**R14 (Critic-8): Limitations section added.** Covers static-analysis scope boundary, false-negative policy, runtime behaviors explicitly out of scope (hook merge order, dynamic variable expansion, plugin load ordering).

**R15 (Additional — PostToolUse matcher): Matcher changed from `"Bash"` to `"*"`.** Ecosystem grep confirms no existing plugin uses `"Bash"` matcher for PostToolUse (only PermissionRequest uses `"Bash"`). All PostToolUse hooks use `"*"`. claudit matches `"*"` and filters internally for Bash tool events via stdin parsing.

**R16 (Additional — build pipeline): tsup selected.** Follows Vercel plugin pattern (compile .ts -> .mjs). Explicit in Stage 1 deliverables.

---

## 1. PipelineStage Breakdown

### Stage 1: `scaffold`

- **Goal:** Create complete project skeleton with all config files, directory layout, build toolchain, and plugin registration.
- **Deliverables:**
  - `package.json` — name `claudit`, type `module`, devDependencies: `typescript`, `tsup`, `vitest`, `@types/node`
  - `tsconfig.json` — target ES2022, module NodeNext, strict, outDir `dist/`
  - `plugin.json` — `name: "claudit"`, `commands: [{"name": "scan", "description": "Run conflict scan manually", "file": "commands/scan.md"}]`
  - `hooks/hooks.json` — skeleton with PostToolUse `"*"` matcher + SessionStart entries (commands pointing to `dist/hooks/`)
  - `tsup.config.ts` — entry points for hooks + scanner, format `esm`, output `.mjs`
  - `src/` directory structure per spec skeleton
  - `commands/scan.md` — command definition file
  - `.gitignore` — dist/, node_modules/
  - `CLAUDE.md` — project conventions
- **Effort:** S
- **`/ccg`:** no
- **Exit criteria:**
  - [ ] `npm install` exits 0
  - [ ] `npx tsc --noEmit` exits 0
  - [ ] `npx tsup` produces files in `dist/`
  - [ ] `plugin.json` contains `commands` array with exactly 1 entry
  - [ ] `hooks/hooks.json` contains exactly 2 hook event entries (PostToolUse, SessionStart)
  - [ ] Directory structure matches spec skeleton (src/detectors/, src/hooks/, commands/)
- **Commit:** `[scaffold] project skeleton with tsup build, plugin.json commands, hooks.json` && git push

---

### Stage 2: `core-types`

- **Goal:** Define all shared types: Detector interface (async), Collision schema (with confidence), Report structure, hook stdout shape, hook stdin parsing contract.
- **Deliverables:**
  - `src/types.ts` — `Collision`, `FixSuggestion`, `Report`, `Confidence`, `Severity`, `CollisionCategory`
  - `src/detector.ts` — `Detector` interface with `analyze(current: Snapshot, previous?: Snapshot): Promise<Collision[]>`
  - `src/report.ts` — `Report` builder, XML-in-additionalContext serializer
  - `src/hook-io.ts` — stdin parser for PostToolUse, stdout builder following convention
  - Unit tests for schema round-trip and serialization
- **Key decisions encoded:**
  - Collision schema: `{category: CollisionCategory, severity: Severity, confidence: Confidence, entities_involved: string[], suggested_fix: FixSuggestion[], message: string}`
  - `Confidence = 'definite' | 'possible' | 'unknown'`
    - `definite`: exact string match collision (duplicate command name, identical matcher+mutation)
    - `possible`: collision detected but dynamic content prevents certainty (unresolved `$CLAUDE_PLUGIN_ROOT`, template literals in hook scripts)
    - `unknown`: detector error, timeout, or unparseable input
  - Hook stdout shape (convention-discovered):
    ```json
    {
      "continue": true,
      "hookSpecificOutput": {
        "hookEventName": "PostToolUse",
        "additionalContext": "<claudit-report>{ ... JSON report ... }</claudit-report>"
      }
    }
    ```
  - Hook stdin shape (PostToolUse receives):
    ```json
    {
      "hook_event_name": "PostToolUse",
      "tool_name": "Bash",
      "tool_input": { "command": "brew install foo" },
      "tool_output": { "stdout": "...", "stderr": "...", "exit_code": 0 }
    }
    ```
    claudit reads `tool_name` to filter for `"Bash"`, then reads `tool_input.command` for regex matching.
  - `$CLAUDE_PLUGIN_ROOT` resolution strategy: for own hooks, use `process.env.CLAUDE_PLUGIN_ROOT`. For analyzing other plugins' hook scripts, compute from `~/.claude/plugins/<plugin-name>/` install path. Unresolvable paths produce `confidence: 'possible'`.
- **Effort:** M
- **`/ccg`:** resolved by ecosystem convention — hook stdout shape adopted from real CC plugin convention, no disagreement remains
- **Exit criteria:**
  - [ ] `Collision` type includes all fields: category, severity, confidence, entities_involved, suggested_fix, message
  - [ ] `confidence` field is typed as `'definite' | 'possible' | 'unknown'`
  - [ ] Mock detector implementing `Detector` interface compiles and returns `Promise<Collision[]>`
  - [ ] `Report.serialize()` produces valid JSON wrapped in `<claudit-report>` tags
  - [ ] `parsePostToolUseStdin(input: string)` extracts tool_name and command string
  - [ ] `buildHookOutput(report: Report)` produces object matching `{continue, hookSpecificOutput: {hookEventName, additionalContext}}` shape
  - [ ] All unit tests pass via `npx vitest run`
- **Commit:** `[core-types] detector interface, collision schema with confidence, hook I/O contracts` && git push

---

### Stage 3: `snapshot`

- **Goal:** Capture `~/.claude/` and project `.claude/` state, diff between snapshots, persist/load from disk.
- **Deliverables:**
  - `src/snapshot.ts` — `Snapshot` class with `constructor(options: {globalRoot?: string, projectRoot?: string})`
  - Snapshot storage at `~/.claude/claudit/snapshots/`, retains last 2
  - Unit tests with fixture directories
- **Key design:**
  - Default `globalRoot`: `~/.claude/`
  - Optional `projectRoot`: current working directory's `.claude/` if it exists
  - Snapshot captures: installed plugins list, hooks.json contents per plugin, settings.json, commands/skills/agents manifests, MCP config
  - Diff returns: added/removed/modified entries per category
  - Storage budget: snapshot files capped at 1MB; truncate large hook script contents to first 4KB for analysis
- **Effort:** M
- **`/ccg`:** no
- **Exit criteria:**
  - [ ] `new Snapshot({globalRoot: fixturePath})` captures all 6 category data sources from fixture
  - [ ] `new Snapshot({globalRoot: fixturePath, projectRoot: projectFixturePath})` captures both global and project-level data
  - [ ] `Snapshot.diff(prev, current)` returns correct added/removed/modified sets for a known fixture pair
  - [ ] `Snapshot.save()` writes to `~/.claude/claudit/snapshots/` and `Snapshot.load()` round-trips
  - [ ] At most 2 snapshot files exist after 3 sequential saves (oldest purged)
  - [ ] Snapshot file size does not exceed 1MB for fixture with 10 plugins
- **Commit:** `[snapshot] state capture with global+project scope, diff, persist/load` && git push

---

### Stage 4: `detector-hook-matcher`

- **Goal:** Detect hook matcher interference — two or more hooks on the same event+matcher where both mutate `updatedInput`.
- **Deliverables:**
  - `src/detectors/hook-matcher.ts`
  - `tests/detectors/hook-matcher.test.ts`
- **Content-aware logic:** Parse each plugin's hooks.json, group hooks by event+matcher key. For groups with 2+ hooks, statically analyze hook scripts for `updatedInput` mutation patterns (assignment to `updatedInput`, `JSON.stringify` of modified input). Both mutating = `confidence: 'definite'`. One mutating + one opaque = `confidence: 'possible'`.
- **Effort:** M
- **`/ccg`:** no
- **Exit criteria:**
  - [ ] Fixture with 2 hooks both mutating `updatedInput` on same matcher produces Collision with `confidence: 'definite'`
  - [ ] Fixture with 1 mutating + 1 read-only hook on same matcher produces no Collision
  - [ ] Fixture with 1 mutating + 1 unparseable hook produces Collision with `confidence: 'possible'`
  - [ ] Fixture with hooks on different matchers produces no Collision
  - [ ] All tests pass via `npx vitest run`
- **Commit:** `[detector-hook-matcher] content-aware hook interference detection` && git push

---

### Stage 5: `detector-slash-command`

- **Goal:** Detect duplicate slash command names across installed plugins.
- **Deliverables:**
  - `src/detectors/slash-command.ts`
  - `tests/detectors/slash-command.test.ts`
- **Content-aware logic:** Enumerate all installed plugins' `plugin.json` `commands` arrays. Compare base names (ignoring plugin namespace prefix). Exact name match = `confidence: 'definite'`.
- **Effort:** S
- **`/ccg`:** no
- **Exit criteria:**
  - [ ] Fixture with 2 plugins both registering command `scan` produces Collision with `confidence: 'definite'`
  - [ ] Fixture with plugins registering `scan` and `status` (no overlap) produces no Collision
  - [ ] Fixture with 3 plugins, 2 overlapping, produces exactly 1 Collision listing both entities
  - [ ] All tests pass
- **Commit:** `[detector-slash-command] duplicate command name detection` && git push

---

### Stage 6: `detector-skill-name`

- **Goal:** Detect duplicate skill names and trigger keyword overlaps across plugins.
- **Deliverables:**
  - `src/detectors/skill-name.ts`
  - `tests/detectors/skill-name.test.ts`
- **Content-aware logic:** Parse skills directories from each plugin. Compare skill names (exact match = `definite`). Compare trigger keywords if defined in skill metadata (overlap = `possible` since trigger precedence is runtime-dependent).
- **Effort:** S
- **`/ccg`:** no
- **Exit criteria:**
  - [ ] Fixture with 2 plugins both defining skill `deploy` produces Collision with `confidence: 'definite'`
  - [ ] Fixture with overlapping trigger keywords produces Collision with `confidence: 'possible'`
  - [ ] Fixture with no overlaps produces no Collision
  - [ ] All tests pass
- **Commit:** `[detector-skill-name] skill name and trigger keyword collision detection` && git push

---

### Stage 7: `detector-subagent-type`

- **Goal:** Detect duplicate subagent type names across plugins.
- **Deliverables:**
  - `src/detectors/subagent-type.ts`
  - `tests/detectors/subagent-type.test.ts`
- **Content-aware logic:** Parse agent definitions from each plugin's manifest. Exact type name match = `confidence: 'definite'`.
- **Effort:** S
- **`/ccg`:** no
- **Exit criteria:**
  - [ ] Fixture with 2 plugins defining agent type `researcher` produces Collision with `confidence: 'definite'`
  - [ ] Fixture with unique agent types produces no Collision
  - [ ] All tests pass
- **Commit:** `[detector-subagent-type] subagent type name collision detection` && git push

---

### Stage 8: `detector-mcp-identifier`

- **Goal:** Detect duplicate MCP server names and cross-server tool name collisions.
- **Deliverables:**
  - `src/detectors/mcp-identifier.ts`
  - `tests/detectors/mcp-identifier.test.ts`
- **Content-aware logic:** Parse MCP config (settings.json `mcpServers` + plugin-level MCP declarations). Server name collision = `confidence: 'definite'`. Tool name collision across different servers = `confidence: 'possible'` (runtime may namespace).
- **Effort:** M
- **`/ccg`:** no
- **Exit criteria:**
  - [ ] Fixture with 2 MCP servers named `github` produces Collision with `confidence: 'definite'`
  - [ ] Fixture with 2 servers exposing tool `search` produces Collision with `confidence: 'possible'`
  - [ ] Fixture with unique server names and unique tool names produces no Collision
  - [ ] All tests pass
- **Commit:** `[detector-mcp-identifier] MCP server and tool name collision detection` && git push

---

### Stage 9: `detector-path-binary`

- **Goal:** Detect PATH binary shadowing — same command name installed at multiple paths.
- **Deliverables:**
  - `src/detectors/path-binary.ts`
  - `tests/detectors/path-binary.test.ts`
- **Content-aware logic:** Split `$PATH`, for each directory list executables. Find command names appearing in 2+ directories. Known benign duplicates (system utilities with identical behavior) filtered via allowlist. Remaining = `confidence: 'definite'` if both files exist and differ in content hash, `confidence: 'possible'` if content comparison unavailable.
- **Effort:** M
- **`/ccg`:** no
- **Exit criteria:**
  - [ ] Fixture PATH with `rtk` in both `/usr/local/bin/` and `~/.cargo/bin/` (different content) produces Collision with `confidence: 'definite'`
  - [ ] Fixture PATH with `ls` in `/bin/` and `/usr/bin/` (allowlisted) produces no Collision
  - [ ] Fixture with unique binary names across all PATH dirs produces no Collision
  - [ ] All tests pass
- **Commit:** `[detector-path-binary] PATH binary shadowing detection` && git push

---

### Stage 10: `scanner-orchestrator`

- **Goal:** Wire all 6 detectors into Scanner, execute with `Promise.allSettled()` + per-detector timeout, aggregate results into Report.
- **Deliverables:**
  - `src/scanner.ts` — `Scanner` class, detector registry, execution orchestrator
  - `tests/scanner.test.ts`
- **Key design:**
  - `Promise.allSettled()` for all 6 detectors in parallel
  - Per-detector timeout: default 100ms, configurable via `Scanner` constructor options
  - Timeout behavior: `AbortController` signal per detector. On timeout, produce `Collision{category: 'internal-error', confidence: 'unknown', message: '<detector-name> exceeded <N>ms timeout'}`
  - Rejected promises: caught, produce same internal-error Collision
  - Report aggregation: flatten all Collision arrays, deduplicate by entity pair, sort by severity then confidence
- **Effort:** S
- **`/ccg`:** no
- **Exit criteria:**
  - [ ] Scanner with 6 mock detectors (3 returning collisions, 2 returning empty, 1 throwing) produces Report with collisions from 3 + internal-error from 1
  - [ ] Mock detector exceeding timeout produces internal-error Collision with `confidence: 'unknown'`
  - [ ] Scanner completes within 150ms when all detectors respond within 100ms
  - [ ] Report contains metadata: timestamp, scan duration, detector count, error count
  - [ ] All tests pass
- **Commit:** `[scanner-orchestrator] parallel detector execution with allSettled + timeout` && git push

---

### Stage 11: `hook-post-tool-use-trigger`

- **Goal:** PostToolUse hook that matches install commands via stdin parsing and writes a pending marker for deferred scanning. Does NOT perform scanning itself.
- **Deliverables:**
  - `src/hooks/post-tool-use.ts` (compiled to `dist/hooks/post-tool-use.mjs`)
  - `src/pending.ts` — pending marker read/write/cleanup utilities
  - `tests/hooks/post-tool-use.test.ts`
  - `tests/pending.test.ts`
- **Hook registration in hooks.json:**
  ```json
  {
    "hooks": {
      "PostToolUse": [{
        "matcher": "*",
        "hooks": [{
          "type": "command",
          "command": "node $CLAUDE_PLUGIN_ROOT/dist/hooks/post-tool-use.mjs",
          "timeout": 5000
        }]
      }]
    }
  }
  ```
- **Matcher rationale:** Using `"*"` (not `"Bash"`) because ecosystem convention has no PostToolUse hooks using `"Bash"` matcher. Internal filtering: parse stdin, check `tool_name === "Bash"`, then regex-match `tool_input.command`.
- **Stdin parsing flow:**
  1. Read stdin as JSON
  2. If `tool_name !== "Bash"`, output `{"continue": true}` and exit (no-op, <10ms)
  3. Extract `tool_input.command` string
  4. Test against install regex set (10 patterns)
  5. On match: write pending marker file, output `{"continue": true, "hookSpecificOutput": {"hookEventName": "PostToolUse", "additionalContext": "<claudit-pending>install detected: <command></claudit-pending>"}}`
  6. On no match: output `{"continue": true}` and exit
- **Install regex initial set (10 patterns):**
  1. `brew install\s+`
  2. `npm install\s+-g\s+` / `npm i\s+-g\s+`
  3. `cargo install\s+`
  4. `pip install\s+` / `pip3 install\s+`
  5. `pipx install\s+`
  6. `uv (add|tool install)\s+`
  7. `curl\s+.*\|\s*(sh|bash)` / `wget\s+.*\|\s*(sh|bash)`
  8. `rtk init`
  9. `claude plugin install\s+` / `claude mcp add\s+`
  10. `go install\s+`
- **Pending marker design:**
  - Location: `~/.claude/claudit/pending/`
  - Format: one JSON file per event, named `{timestamp}-{hash}.json`
    ```json
    {
      "timestamp": "2026-04-20T12:00:00Z",
      "trigger": "PostToolUse",
      "command": "brew install foo",
      "matched_pattern": "brew install\\s+"
    }
    ```
  - Batching: rapid installs produce separate files. SessionStart (Stage 12) reads all pending files, merges into a single scan pass, then deletes consumed files.
  - Cleanup: on successful scan completion, all consumed pending files are deleted. On scan failure, files are preserved for next SessionStart attempt.
  - Crash resilience: files persist on disk; no in-memory state. CC crash between write and next SessionStart simply means deferred scan runs on next session.
  - **`/ccg eligible`**: pending marker location/format/lifecycle is a genuinely contested design with 3+ viable options (file vs JSON-in-snapshot vs env var). Concrete default specified above so executor is unblocked. If executor encounters friction with this design, invoke /ccg.
- **Effort:** M
- **`/ccg`:** yes - pending marker location/format/lifecycle (3+ viable options). Default provided; invoke /ccg only if executor encounters design friction.
- **Exit criteria:**
  - [ ] Hook receiving stdin with `tool_name: "Bash"` and `command: "brew install ripgrep"` writes a pending marker file to `~/.claude/claudit/pending/`
  - [ ] Hook receiving stdin with `tool_name: "Bash"` and `command: "ls -la"` writes no pending marker and exits <10ms
  - [ ] Hook receiving stdin with `tool_name: "Edit"` writes no pending marker and exits <10ms
  - [ ] Pending marker file is valid JSON with all required fields (timestamp, trigger, command, matched_pattern)
  - [ ] All 10 regex patterns match their intended commands and do NOT match `npm install` (local, no -g flag)
  - [ ] Hook stdout is valid JSON matching the convention shape in all cases (match and no-match)
  - [ ] All tests pass
- **Commit:** `[hook-post-tool-use-trigger] install command detection with pending marker write` && git push

---

### Stage 12: `hook-session-start`

- **Goal:** SessionStart hook that (a) consumes pending markers from Stage 11, (b) runs snapshot diff for session-external changes, (c) executes full scan via Scanner, (d) injects report into Claude context.
- **Deliverables:**
  - `src/hooks/session-start.ts` (compiled to `dist/hooks/session-start.mjs`)
  - `tests/hooks/session-start.test.ts`
- **Hook registration in hooks.json:**
  ```json
  {
    "hooks": {
      "SessionStart": [{
        "matcher": "",
        "hooks": [{
          "type": "command",
          "command": "node $CLAUDE_PLUGIN_ROOT/dist/hooks/session-start.mjs",
          "timeout": 10000
        }]
      }]
    }
  }
  ```
- **Execution flow:**
  1. Check `~/.claude/claudit/pending/` for pending marker files
  2. Take new snapshot (global + project scope)
  3. Load previous snapshot if exists
  4. If pending markers exist OR snapshot diff shows changes: run Scanner
  5. If no pending markers AND no diff changes: output `{"continue": true}` (silent, no report)
  6. On scan results: serialize Report, output via hook stdout convention with report in `additionalContext`
  7. Save current snapshot, delete consumed pending marker files
- **Effort:** M
- **`/ccg`:** no
- **Exit criteria:**
  - [ ] With pending markers present: Scanner runs and report is injected via stdout
  - [ ] With no pending markers but snapshot diff showing changes: Scanner runs and report is injected
  - [ ] With no pending markers and no snapshot diff: hook outputs `{"continue": true}` with no report, completes <50ms
  - [ ] Consumed pending marker files are deleted after successful scan
  - [ ] Failed scan preserves pending marker files (not deleted)
  - [ ] Hook completes within 500ms for a fixture with 5 installed plugins
  - [ ] All tests pass
- **Commit:** `[hook-session-start] deferred scan with pending marker consumption and snapshot diff` && git push

---

### Stage 13: `command-scan`

- **Goal:** `/claudit scan` command for manual trigger — runs the same Scanner pipeline on demand.
- **Deliverables:**
  - `commands/scan.md` — command definition with description and usage
  - `src/commands/scan.ts` (if command requires code beyond the md definition)
- **Registration:** `plugin.json` `commands` array entry:
  ```json
  {"name": "scan", "description": "Scan for configuration conflicts across installed plugins, hooks, commands, MCP servers, and PATH binaries", "file": "commands/scan.md"}
  ```
- **Effort:** S
- **`/ccg`:** no
- **Exit criteria:**
  - [ ] `plugin.json` `commands` array contains the `scan` entry
  - [ ] `commands/scan.md` exists and contains valid command definition
  - [ ] Command invocation triggers full Scanner pipeline and outputs report
  - [ ] Report format is identical to hook-injected reports
  - [ ] All tests pass
- **Commit:** `[command-scan] manual /claudit scan command registration` && git push

---

### Stage 14: `e2e-test-harness`

- **Goal:** End-to-end test harness covering 3 real-world scenarios + ralph-verify criteria validation.
- **Deliverables:**
  - `tests/e2e/rtk-path-shadowing.test.ts` — rtk in cargo + local bin
  - `tests/e2e/duplicate-scan-command.test.ts` — two plugins both registering `/scan`
  - `tests/e2e/hook-input-mutation.test.ts` — two hooks mutating PreToolUse updatedInput on same matcher
  - `tests/e2e/fixtures/` — realistic plugin directory structures
  - `tests/ralph-verify.test.ts` — automated subset of ralph-verify criteria
- **Effort:** L
- **`/ccg`:** no
- **Exit criteria:**
  - [ ] rtk PATH shadowing scenario: Scanner returns Collision with category `path-binary`, confidence `definite`, entities listing both paths
  - [ ] Duplicate /scan scenario: Scanner returns Collision with category `slash-command`, confidence `definite`
  - [ ] Hook mutation scenario: Scanner returns Collision with category `hook-matcher`, confidence `definite`
  - [ ] Each E2E test uses realistic fixture data (not mocks) and exercises the full pipeline: Snapshot -> Scanner -> Report
  - [ ] Ralph-verify automated checks pass (see section 5)
  - [ ] All tests pass via `npx vitest run`
- **Commit:** `[e2e-test-harness] 3 E2E scenarios + ralph-verify automated checks` && git push

---

### Stage 15: `docs-and-polish`

- **Goal:** False-positive/false-negative policy documentation, README, inline JSDoc on public APIs.
- **Deliverables:**
  - `README.md` — usage, architecture overview, limitations
  - JSDoc on all public exports
  - `src/policies.ts` — exported constants for false-positive rules and confidence thresholds
- **Effort:** S
- **`/ccg`:** no
- **Exit criteria:**
  - [ ] README contains: installation, usage (/claudit scan), architecture diagram (text), limitations section
  - [ ] All public functions/classes have JSDoc with @param and @returns
  - [ ] False-positive policy matches spec: "same matcher with multiple hooks is NOT a collision; only confirmed mutual input mutation IS"
  - [ ] False-negative policy documented: "runtime-dependent behaviors (hook ordering, dynamic variable expansion) may produce false negatives; mitigated via confidence field"
  - [ ] `npx tsc --noEmit` still passes (no type regressions)
- **Commit:** `[docs-and-polish] documentation, JSDoc, policy constants` && git push

---

### Stage 16: `marketplace-release`

- **Goal:** Finalize marketplace.json, verify dist/ build, /plugin install smoke test.
- **Deliverables:**
  - `marketplace.json` — finalized with correct metadata
  - `dist/` — clean build output
  - Verification: `/plugin install` from local path succeeds
- **Effort:** S
- **`/ccg`:** no
- **Exit criteria:**
  - [ ] `npm run build` (tsup) exits 0 and produces all expected `.mjs` files in `dist/`
  - [ ] `marketplace.json` contains valid metadata (name, version, description, author)
  - [ ] `/plugin install <local-path>` completes without error (manual step)
  - [ ] After install, `/claudit scan` command appears in available commands
  - [ ] Hooks fire correctly on SessionStart (manual verification)
- **Commit:** `[marketplace-release] build finalization and marketplace metadata` && git push

---

## 2. RALPLAN-DR Summary

### Principles (5)

1. **P1: Never mutate** — claudit never modifies user config, settings.json, CLAUDE.md, or any plugin files. Read-only observer.
2. **P2: Pluggable detectors** — each of 6 categories is an independent module implementing a common async `Detector` interface. New categories added without touching Scanner.
3. **P3: All 6 content-aware** — v0.1 ships all 6 categories with content-aware (not surface-level) detection. No descoping.
4. **P4: OMC-independent** — zero OMC imports or runtime dependencies. Works for any Claude Code user.
5. **P5: Latency-bounded** — PostToolUse trigger <200ms (regex match + file write only). SessionStart full scan <500ms. Enforced via per-detector 100ms timeout with `Promise.allSettled`.

### Decision Drivers (3)

1. **Claude-parsability** — reports must be machine-parsable by Claude for autonomous explanation and fix execution. XML-wrapped JSON in `additionalContext` string is the convention.
2. **Plugin ecosystem conventions** — follow real CC plugin patterns (hooks.json at `hooks/hooks.json`, `"*"` matcher for PostToolUse, command registration in plugin.json, hook stdout shape).
3. **Content-aware fidelity** — minimize false positives (only confirmed mutual interference is a collision) while acknowledging false negatives for runtime-dependent behaviors via confidence field.

### Viable Options for Genuinely Contested Decisions

**Decision: Pending marker storage (Stage 11) — /ccg eligible**

| Option | Pros | Cons |
|--------|------|------|
| A) File per event in `~/.claude/claudit/pending/` (DEFAULT) | Crash-resilient, no shared state, easy to enumerate, trivial cleanup | Many small files on rapid install bursts, directory creation overhead |
| B) Single JSON array file `~/.claude/claudit/pending.json` | Single file to read, atomic append possible | Concurrent write corruption risk, partial read on crash |
| C) Environment variable `CLAUDIT_PENDING_SCAN=1` | Zero disk I/O, simplest implementation | Lost on process exit, cannot carry install details, no batching info |

Default: Option A. Executor proceeds with A unless friction discovered, at which point /ccg is invoked.

---

## 3. Resolved Open Questions

| # | Question | Resolution | Status |
|---|----------|------------|--------|
| Q1 | Distribution channel | Plugin marketplace only (v0.1). GitHub release and npm deferred to v0.2+. | Resolved |
| Q2 | OS targets | macOS + Linux. Windows/WSL deferred. | Resolved |
| Q3 | Performance budget | PostToolUse trigger <200ms (regex only, no scan). SessionStart <500ms (full scan). Per-detector timeout 100ms. | Resolved |
| Q4 | Report format | JSON wrapped in `<claudit-report>` XML tags, placed inside `additionalContext` string of hook stdout convention `{continue, hookSpecificOutput: {hookEventName, additionalContext}}`. Convention discovered from ecosystem — no /ccg needed. | Resolved |
| Q5 | Detector interface signature | `analyze(current: Snapshot, previous?: Snapshot): Promise<Collision[]>`. Async mandatory. Error isolation via `Promise.allSettled()` + per-detector timeout. Convention-aligned — no /ccg needed. | Resolved |
| Q6 | Snapshot storage location | `~/.claude/claudit/snapshots/`, retain last 2. Cap per-snapshot at 1MB. | Resolved |
| Q7 | Install regex initial set | 10 patterns defined in Stage 11. Extensible via config file in future versions. Patterns validated against positive and negative examples in tests. No /ccg needed — set is concrete and testable. | Resolved |

---

## 4. ralph-verify Plan (Revised)

### Criterion 1: Install Verification

**Automated checks (in `tests/ralph-verify.test.ts`):**
- [ ] `hooks/hooks.json` exists at plugin root (convention path, auto-discovered by CC — NOT declared in plugin.json)
- [ ] `hooks/hooks.json` parses as valid JSON matching expected schema: `{hooks: {PostToolUse: [...], SessionStart: [...]}}`
- [ ] Each hook entry has `type: "command"`, a non-empty `command` string, and a numeric `timeout`
- [ ] Hook command paths reference files that exist in `dist/hooks/`
- [ ] `plugin.json` contains `commands` array (not `skills`)
- [ ] `plugin.json` `name` field is `"claudit"`
- [ ] `dist/` contains all expected `.mjs` compiled outputs
- [ ] `npm run build` exits 0

**Manual steps:**
- [ ] Run `/plugin install <local-path>` — verify installation completes
- [ ] Verify `/claudit scan` appears in available commands
- [ ] Run `/claudit scan` — verify report output (or "no conflicts" message)

### Criterion 2: Namespace Verification

**Automated checks:**
- [ ] Programmatically enumerate ALL installed plugins by reading `~/.claude/plugins/` directory
- [ ] For each installed plugin, parse its `plugin.json` and collect: commands (names), skills (names), agents (type names), MCP server names
- [ ] Collect claudit's own identifiers: plugin name `"claudit"`, command `"scan"`
- [ ] Assert zero intersection between claudit's identifiers and any other installed plugin's identifiers
- [ ] Specifically verify: no other plugin registers a command named `"scan"` (beyond claudit itself)

**Manual steps:**
- [ ] Review `/plugin list` output (or equivalent) to visually confirm no naming conflicts

### Criterion 3: Idempotency (Setup Re-run)

**Automated checks:**
- [ ] Run build twice sequentially — `dist/` output is byte-identical
- [ ] `hooks/hooks.json` has exactly 2 event entries (PostToolUse, SessionStart) — not duplicated
- [ ] `plugin.json` is unchanged after second build
- [ ] `~/.claude/claudit/snapshots/` contains at most 2 files after multiple SessionStart invocations

**Manual steps:**
- [ ] Uninstall and reinstall plugin — verify clean state, no leftover artifacts in `~/.claude/claudit/`

---

## 5. Limitations

### Static Analysis Scope

claudit is a **static analyzer** operating on file contents at rest. It reads configuration files (hooks.json, plugin.json, settings.json, MCP configs) and hook script source code. It does NOT:

- Execute hook scripts or observe their runtime behavior
- Intercept or monitor live hook execution chains
- Access Claude Code's internal plugin resolution or priority logic
- Observe runtime environment variable values beyond `process.env` at scan time

### False-Negative Policy

The following scenarios may produce **false negatives** (real conflicts that claudit does not report):

1. **Hook execution ordering:** Claude Code may execute hooks from multiple plugins in an order that creates conflicts through composition (e.g., Plugin A's output feeds Plugin B's input in a way neither hook alone reveals). claudit cannot determine hook execution order across plugins.
2. **Dynamic variable expansion:** Hook scripts using template literals, dynamic `require()`, or computed paths based on runtime state cannot be fully analyzed statically. These produce `confidence: 'possible'` when detected, but may be missed entirely if the dynamic pattern is not recognized.
3. **Hook merge/de-duplication:** The CC runtime may apply de-duplication or priority logic to hooks that share matchers. claudit does not know these rules and analyzes hooks as independent units.
4. **Post-install plugin registration:** If a plugin modifies its own configuration after initial install (e.g., lazy skill registration), claudit's snapshot may not capture the final state.

**Mitigation:** The `confidence` field on every Collision signals analysis certainty. Consumers (Claude or human) should treat `possible` and `unknown` confidence collisions as requiring manual verification. Documentation explicitly states: "claudit catches the common cases; edge cases involving runtime composition require manual review."

### False-Positive Policy

Per spec: "same matcher with multiple hooks" alone is NOT a collision. Only **confirmed mutual input mutation** (both hooks writing to `updatedInput` on the same event+matcher) is reported. This minimizes noise while catching the most impactful hook interference pattern.

---

## 6. ADR (Architecture Decision Record)

### Decision

Build claudit as a Claude Code plugin using a trigger-and-defer architecture: PostToolUse hook performs lightweight regex matching and writes pending markers; SessionStart hook consumes markers and runs full content-aware scanning via 6 parallel detectors behind `Promise.allSettled()` with per-detector timeouts.

### Drivers

1. **Latency constraint:** PostToolUse must complete in <200ms; content-aware analysis of 20-50 files is impossible in that budget.
2. **Reliability:** `Promise.allSettled()` ensures one detector failure does not block the entire scan.
3. **Ecosystem alignment:** Real CC plugins use `"*"` matcher, specific hook stdout JSON shape, `hooks/hooks.json` convention path, and command registration via plugin.json.

### Alternatives Considered

| Alternative | Why Rejected |
|-------------|-------------|
| **Full scan in PostToolUse** | P5 violation: content-aware analysis of multiple plugin directories cannot complete in 200ms. Would require descoping to surface-level detection, violating P3. |
| **Background timer/polling** | No CC-native mechanism for background execution between hooks. Would require a persistent daemon process — over-engineered for v0.1, and platform-dependent. |
| **SessionStart-only scanning** | Misses the "install just happened" signal. User would need to start a new session to see conflicts from an in-session install. Pending marker approach gives SessionStart the knowledge that a scan is warranted. |
| **Synchronous detector execution** | One slow or broken detector blocks the entire scan, risking timeout. `Promise.allSettled` + per-detector timeout is strictly better for reliability. |
| **Skill registration instead of command** | Both Architect and Critic agree: manual-trigger scan is a command, not a skill. Follows Vercel plugin pattern. |

### Why Chosen

Trigger-and-defer balances all 5 principles: content-aware fidelity (P3) within latency bounds (P5), modular detectors (P2), read-only operation (P1), and no OMC dependency (P4). The pending marker mechanism is simple (JSON files on disk), crash-resilient (survives CC process termination), and naturally batches rapid installs (SessionStart reads all pending files at once).

### Consequences

- **Positive:** Scan results appear at next session start — natural UX integration point. Per-detector timeouts prevent one bad detector from degrading the whole system. Confidence field sets correct user expectations about static analysis limits.
- **Negative:** In-session installs do not get immediate scan results (deferred to next SessionStart). Users who never restart sessions may miss scan reports (mitigated by `/claudit scan` manual command). Pending marker directory is a new disk artifact in `~/.claude/`.
- **Neutral:** 16-stage pipeline is moderately large but each stage is focused and independently verifiable. Build toolchain (tsup) adds a dev dependency but produces clean ESM output.

### Follow-ups

- v0.2: Consider watch-mode or notification mechanism for in-session scan results (if CC adds background execution support).
- v0.2: Evaluate pending marker design in production — if file-per-event causes issues at scale, revisit with /ccg.
- v0.2: Expand install regex set based on real-world usage data.
- v0.2: Consider Windows/WSL support (PATH separator, shell differences).
- v0.2: npm + GitHub release distribution channels.
