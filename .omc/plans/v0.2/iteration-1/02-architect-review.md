# Architect Review — Iteration 1

## Verdict: ITERATE

---

## 1. Steelman Antithesis: Could v0.1.1 Patches Suffice?

The strongest case against this plan: 5 of the 6 CRITICAL/HIGH gaps are localized fixes, not architectural rewrites. Matcher overlap (#6) is a new module. Namespace semantics (#7) is a classifier change. YAML block-list parsing (#5) is a parser swap. `enabledPlugins` (#8) is a filter addition. `plugin.json` field normalization (#3, #4) is a handler extension. Only gap #2 (5-scope hook sources) and #1 (cache depth) genuinely require rethinking snapshot's discovery model.

A disciplined v0.1.1 could have: (a) fixed `resolvePluginRoots` depth, (b) added `captureUserSettings()` as a new method returning hooks injected into the existing `SnapshotData.plugins` array as pseudo-plugins, (c) swapped the frontmatter parser, (d) added `matcher-overlap.ts` called from the existing grouping function. That is perhaps 60% of the code delta with zero rewrite risk.

**However**, the plan's rewrite is justified for one reason the patch approach cannot cleanly handle: the v0.1 `SnapshotData` schema has no concept of hook source provenance, and retrofitting it into `PluginSummary` as pseudo-plugins is a semantic lie that would confuse every downstream consumer. A clean `HookSource` enum with typed entries is architecturally honest. The rewrite scope (1 full rewrite + 4 refactors out of 17 files) is proportionate. Verdict: rewrite is warranted, but the plan has structural gaps that must be fixed first.

---

## 2. Tradeoff Tensions

**Tension A — Vendored YAML parser maintenance surface.** The plan allocates ~80 lines for a subset parser covering 3 constructs. Fine today, but CC skill frontmatter already uses `pipeline: [deep-dive, omc-plan, autopilot]` and keys like `handoff`. If a plugin starts using YAML flow mappings or multiline strings, the vendored parser silently fails or produces garbage (per Limitation #8). Stage 1's exit criteria have no negative test for unsupported YAML producing a clear warning. **Required fix: add exit criterion for graceful parse-warning on unsupported YAML constructs.**

**Tension B — `types.ts` claimed UNTOUCHED is false.** Section 0 says `types.ts` schema is "unchanged, new fields added additively (no breaking changes)." Code evidence contradicts this:
- `PluginAgent.type` (`types.ts:113`) must become `PluginAgent.name` per ground-truth (`cc-schema-ground-truth.md:139`) and Stage 3's own exit criterion ("Agent `name` field (not `type`) is used as the identifier"). That is a breaking rename, not additive.
- `PluginSummary` (`types.ts:122-130`) needs `source: HookSource` and `enabled: boolean` fields for the 5-scope model and `enabledPlugins` filtering.
- `HookRegistration` (`types.ts:97-100`) needs source metadata for cross-source collision reporting (Stage 2 exit criteria require `entities_involved` listing `HookSource` type).

The plan must either (a) add a Stage 0 for `types.ts` schema evolution, or (b) fold type changes into Stage 1 and remove `types.ts` from the UNTOUCHED list. Claiming "unchanged" while 3+ types need modification misleads the executor.

---

## 3. Closure Verification

| Gap | Stage | Exit Criterion | Closed? |
|-----|-------|----------------|---------|
| Codex CRITICAL: user-level hook scanning | 1 | `captureUserSettings()` returns hooks from `settings.json` fixture with rtk PreToolUse entry | YES |
| Codex CRITICAL: real MCP discovery chain (string-path) | 4 | Plugin with `"mcpServers": "./.mcp.json"` resolves and reads the referenced config | YES |
| Codex HIGH: matcher overlap semantics | 2 | `"Edit\|Write"` vs `"Edit"` produces collision; `"Bash"` vs `"Read"` produces none | YES |
| Codex HIGH: namespace-aware detection | 3 | Two plugins both defining `scan` produces `info/possible` with disambiguation message | YES |
| GPT MAJOR: YAML frontmatter parser | 1 | Block-list `triggers` parses to array | YES |
| GPT MAJOR: PATH executable-only filter | 5 | Non-executable excluded; symlink followed | YES |
| GPT MAJOR: pending marker redaction | 6 | 4 secret patterns redacted, non-secrets preserved | YES |
| Gemini HIGH: FixSuggestion `# comment` | 6 | No FixSuggestion contains `# comment`; empty command requires `manual-review` | YES |
| Gemini HIGH: `scan.md` JSON-parsing directive | 6 | 7 explicit directives including base64 decode | YES |

All 9 gaps have traceable exit criteria. Closure verified.

---

## 4. RALPLAN-DR Principle Consistency

- **P1 (Never mutate):** Respected.
- **P2 (Evidence-driven):** Respected. Exit criteria reference ground-truth fixtures.
- **P3 (Zero runtime deps):** Respected. YAML subset parser vendored.
- **P4 (Correct before complete):** **Minor violation.** Stage 6 bundles report hardening (base64), redaction, FixSuggestion cleanup, AND `scan.md` directives — 4 orthogonal concerns in one stage. If base64 encoding breaks, it blocks redaction testing. Recommend splitting into 6a (report base64) and 6b (redaction + FixSuggestion + scan.md).
- **P5 (Namespace-aware):** Respected.

No `/ccg` flags needed; open-question resolutions are genuinely clear-cut.

---

## 5. Guardrail Compliance

- **Stage commits + no AI attribution:** YES.
- **/ccg gating:** Appropriate. Zero `/ccg` flags; no overuse.
- **Phase 4 CCG guardrail enforced:** YES. Codex + Gemini parallel review after Stage 7, CRITICAL findings block Stage 8+. Invocation protocol concrete.
- **ralph-verify rigor:** INSUFFICIENT. Criteria 4 (multi-source) and 5 (flagship) are good additions, but no **regression** criterion — do the 109 v0.1 tests still pass after snapshot rewrite? Stage 10 mentions "all tests pass" but ralph-verify should independently assert v0.1 test count is preserved. Add a regression criterion.

---

## 6. Required Revisions for Iteration-2

1. **Remove `types.ts` from UNTOUCHED list.** Add type schema evolution (PluginAgent rename, HookSource enum, PluginSummary.source/enabled fields) either as a new Stage 0 or folded into Stage 1's deliverables. The current claim is factually wrong per the plan's own exit criteria.

2. **Add YAML parse-warning negative test to Stage 1.** Exit criterion: "YAML frontmatter with unsupported construct (e.g., multiline folded string `>`) produces a parse warning, not silent data loss."

3. **Split Stage 6** into 6a (report base64 encode/decode) and 6b (redaction + FixSuggestion cleanup + scan.md). These are independent concerns with independent test suites.

4. **Add v0.1 regression criterion to ralph-verify.** "v0.1 test files in `tests/` (excluding `tests/*-v2/` and `tests/e2e/`) produce the same pass count as before the rewrite."

5. **Clarify `session-start.ts` UNTOUCHED claim.** If `SnapshotData` gains new fields (settings hooks, enabledPlugins map), does `session-start.ts` need to pass new options? If snapshot derives everything internally from `globalRoot`/`projectRoot`, state that explicitly. If not, move `session-start.ts` to HARDENED.

---

## Files Referenced

- `/Users/2026editor/Documents/proj/claudit/src/types.ts:97-140` — HookRegistration, PluginAgent, PluginSummary, SnapshotData types
- `/Users/2026editor/Documents/proj/claudit/src/detectors/hook-matcher.ts:112-142` — `groupByEventAndMatcher` iterates only `snapshot.plugins`, needs source awareness
- `/Users/2026editor/Documents/proj/claudit/src/snapshot.ts:32-42` — SnapshotOptions constructor shape
- `/Users/2026editor/Documents/proj/claudit/src/hooks/session-start.ts:48-53` — Snapshot construction call site
- `/Users/2026editor/Documents/proj/claudit/.omc/research/cc-schema-ground-truth.md:139` — agent `name` field ground truth contradicting `PluginAgent.type`
