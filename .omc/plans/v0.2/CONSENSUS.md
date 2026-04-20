# Ralplan Consensus v0.2 — 2026-04-20

**Status:** APPROVED on iteration 2 of 5 max.

## Pipeline

- CCG external review (Codex + Gemini + prior GPT) exposed 19 issues v0.1 internal reviewers missed.
- Research phase: `.omc/research/cc-schema-ground-truth.md` (empirical CC schema) + `.omc/research/v0.2-redesign-plan.md`.
- Ralplan iteration 1: Planner (519 lines) → Architect (ITERATE, R1–R5) → Critic (ITERATE, C1–C4 + endorses R1–R5). Consolidated 9 required revisions.
- Ralplan iteration 2: Planner (revised 711 lines, 12 stages) → Architect (APPROVE) → Critic (APPROVE).

## Final Plan

**Primary artifact:** `.omc/plans/v0.2/iteration-2/01-planner-revised.md` (711 lines, 12 stages).

## Consensus Decisions

- **Retain** v0.1 architecture: Scanner, Report, hook-IO, pending, policies, post-tool-use hook, session-start hook (SnapshotOptions unchanged).
- **Rewrite** `snapshot.ts` (cache depth 3, marketplace dir support, 5-source hooks, YAML subset parser with block-list support, plugin.json field normalization for skills/mcpServers, enabledPlugins filter).
- **Rename** `PluginAgent.type → .name` (breaking).
- **Add** `HookSource` enum, `PluginSummary.{source, enabled}`, `HookRegistration.source`, `SnapshotData.settingsHooks`.
- **Refactor** hook-matcher (cross-source matcher-overlap grouping, drop standalone `JSON.stringify` mutation signal), slash-command/skill-name/subagent-type (namespace-aware, downgrade duplicates to `info/possible`, drop destructive fix advice), mcp-identifier (extend inputs: user/project .mcp.json, resolve string-path refs).
- **Fix** path-binary (follow symlinks with loop guard, hash target, executable-bit filter).
- **Harden** report (base64 payload wrapper), pending (redact 8 secret patterns), FixSuggestion (no `# comment` placeholders — empty command + `manual-review` + rationale instead), scan.md (8 explicit directives including namespace-disambiguation).
- **12-stage pipeline** with `[v2-*]` commit tokens + push per stage.
- **Phase 4 validation guardrail:** CCG (Codex + Gemini via `omc ask`) MANDATORY alongside architect/security/code-reviewer. Hard-blocked, no silent skip.
- **ralph-verify** 6 criteria including regression floor (≥ 100/109 v0.1 tests survive without modification).

## Verified CCG Finding Coverage

All 19 findings from the three external review sources (GPT-5.4, Codex, Gemini) have traceable closure in iteration-2 exit criteria. See iteration-2 Architect review section "Closure Verification" for the map.

## Zero `/ccg` Flags

All 5 open questions (YAML parser, report wrapper, redaction scope, namespace policy, enabledPlugins handling) resolved with dominant options in iteration-1 Planner draft. No genuine 3-option forks remain.

## Next Step

Hand off to `oh-my-claudecode:autopilot`. Autopilot detects `.omc/plans/v0.2/CONSENSUS.md` + `.omc/plans/v0.2/iteration-2/01-planner-revised.md` and skips Phase 0 + Phase 1, starting directly at Phase 2 (Execution).

Autopilot MUST invoke CCG (Codex + Gemini) in Phase 4 per Section 5 of the revised plan — this is a hard guardrail, not optional.

---

## Post-approval deltas accepted on 2026-04-20

Two additive deltas from `.omc/plans/v0.2/OPEN-DELTAS.md` are folded into the approved plan without re-review (both ≤15 LOC, additive-only per OPEN-DELTAS §4):

- **Delta 1 (MCP probe paths — Option A):** Stage 1 `captureUserSettings` probes `~/.claude.json` at home root; if present, its `.mcpServers` is merged into user-level MCP config; if absent, skip silently. Covered by new Stage 1 exit criterion.
- **Delta 2a (managed hook scope — Option A):** `HookSource` enum gains a 7th value `user-managed`. Stage 1 probes a managed settings path; discovered hooks are tagged `source: 'user-managed'`. Covered by Stage 0 + Stage 1 exit criteria.
- **Delta 2c (non-command hook types — Option C):** `HookScript` gains `kind: 'command' | 'prompt' | 'agent' | 'http' | 'unknown'` and optional `rawConfig?: unknown`. Stage 1 preserves non-command hook entries with `kind` and `rawConfig`; detectors treat non-command kinds as `confidence: unknown` (no silent drop). Covered by Stage 0 + Stage 1 exit criteria.

Deltas not adopted: Delta 1 Option B, Delta 2 Options B and D.

`OPEN-DELTAS.md` is marked CLOSED.
