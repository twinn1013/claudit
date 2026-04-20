# AGENTS.md — claudit

Project: Claude Code plugin that detects configuration conflicts (hooks, commands, skills, agents, MCP servers, PATH binaries). Read-only observer — never mutates user config.

## ▶︎ READ FIRST

The project is **mid-execution of the v0.2 rebuild**, paused after Stage 7b.

1. `.omc/RESUME.md` — current session state, commit chain, next-action brief, how to resume.
2. `.omc/plans/v0.2/CONSENSUS.md` — ralplan consensus (APPROVED iter-2, with post-approval deltas folded in).
3. `.omc/plans/v0.2/iteration-2/01-planner-revised.md` — primary plan artifact, 12 stages with exit criteria.
4. `.omc/research/cc-schema-ground-truth.md` — empirical Claude Code schema audit; every assumption in v0.2 must trace to this.
5. `CLAUDE.md` — conventions (ESM, TS 5+, Node 20+, zero runtime deps, commit format).

## Current state (2026-04-20)

- 8 of 11 coding stages done on `main`. 270/270 tests green.
- Last commit: `b0ca72d [v2-redaction-scanmd]`. Resume marker: `7e46d0e [resume]`.
- **Next stage: `[v2-e2e-flagship]`** — rtk+OMC end-to-end scenario. Plan lines 344-358.
- **After Stage 8: Phase 4 validation** — HARD GUARDRAIL requires CCG (Codex + Gemini via `omc ask`) alongside architect + security-reviewer + code-reviewer. No silent skip. Plan Section 5 lines 506-602.

## Commit chain (v0.2)

```
b0ca72d [v2-redaction-scanmd]         — Stage 7b (270 tests)
b313b3b [v2-report-base64]            — Stage 7a (220)
9f3b3ef [v2-stage6-skip]              — Stage 6 reserved, empty
09c2537 [v2-detector-path-binary]     — Stage 5 (210)
cac32eb [v2-detector-mcp]             — Stage 4 (202)
bf571b8 [v2-detector-namespace]       — Stage 3 (194)
10a1a79 [v2-detector-hook-matcher]    — Stage 2 (185)
0c3a75d [v2-snapshot]                 — Stage 1 (151)
1338e59 [v2-types]                    — Stage 0 (114)
```

## Build / test / typecheck

```bash
npm run build       # tsup -> dist/
npm run typecheck   # tsc --noEmit
npm test            # vitest run
```

## Conventions (from CLAUDE.md)

- Commit messages: `[stage-token] <summary>`. No AI attribution.
- Each `[v2-*]` stage commits and pushes to `origin main` independently.
- Zero runtime dependencies — YAML subset is vendored in `src/yaml-frontmatter.ts`.
- Report wrapper: `<claudit-report>` + base64 JSON payload (Stage 7a).
- Hook stdout shape: `{ continue: true, hookSpecificOutput: { hookEventName, additionalContext } }`.

## Phase 4 — DO NOT SKIP

After Stage 8 ships, BEFORE Stage 9:

1. Pre-check: `which codex && which gemini || which omc`. If none → Phase 4 BLOCKED. Install one of them OR write `.omc/plans/v0.2/manual-review-notes.md` documenting a manual human review covering the same scope as the missing reviewer's prompt (plan lines 543-586). **No silent skip.**
2. Parallel invocations (internal + external, all 5 reviewers):
   - `architect` agent
   - `security-reviewer` agent
   - `code-reviewer` agent
   - `omc ask codex` with plan's Codex prompt template (lines 545-564)
   - `omc ask gemini` with plan's Gemini prompt template (lines 567-586)
3. CRITICAL findings block Stage 9+. MAJOR findings: fix if feasible or document in Limitations. INFO findings: log to `.omc/plans/v0.2/external-review-notes.md`.
4. Artifact CCG results to `.omc/artifacts/v0.2-phase4-*.md`.

## Regression floor

At least 100 of 109 v0.1 tests must still pass without modification. Currently well above (most v0.1 tests green; the few updates were mechanical field additions or v0.2 semantics changes e.g. `definite`→`possible` for namespace ambiguity).

## Remaining stages

- Stage 8 `[v2-e2e-flagship]` — rtk+OMC E2E, namespace-ambiguity, disabled-plugin (M effort)
- Phase 4 validation with CCG (blocking)
- Stage 9 `[v2-ralph-verify]` — 6-criterion verification suite, includes v0.1 regression floor (S)
- Stage 10 `[v2-docs-polish]` — README, CLAUDE.md, JSDoc, policy constants (S)
- Stage 11 `[v2-release]` — package.json 0.2.0, marketplace.json, build, manual smoke (S)

## Layout reference

- `.claude-plugin/plugin.json` — plugin metadata
- `hooks/hooks.json` — CC-auto-discovered hook registration
- `commands/scan.md` — `/claudit scan` slash command (Stage 7b: 8 directives)
- `src/` — TypeScript source
  - `snapshot.ts` (rewritten Stage 1), `scanner.ts`, `detector.ts`, `report.ts` (base64 wrapper Stage 7a)
  - `detectors/` — 6 detectors
  - `yaml-frontmatter.ts` (Stage 1 extraction), `matcher-overlap.ts` (Stage 2), `redactor.ts` (Stage 7b), `policies.ts`
- `tests/` — vitest unit + e2e + snapshot-v2 + security suites
