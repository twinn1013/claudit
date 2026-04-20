# Session Resume — claudit v0.2 Rebuild

**Last touched:** 2026-04-20 (session ended mid-autopilot Phase 2)

## Current state

- **v0.1 shipped** — 17 commits on `main` pushed to `origin`. `a39fd23` is the last v0.1 commit.
- **External triple-review (GPT + Codex + Gemini) exposed 19 issues** v0.1 internal reviewers missed, including a CRITICAL: claudit's flagship scenario (rtk + OMC hook interference in `~/.claude/settings.json`) goes undetected because v0.1 never scans user-level settings.
- **v0.2 ralplan consensus APPROVED** on iteration 2 (Architect + Critic both). Commit `d829423`.
- **Primary plan artifact:** `.omc/plans/v0.2/iteration-2/01-planner-revised.md` (711 lines, 12 stages).
- **Research evidence:** `.omc/research/cc-schema-ground-truth.md` + `.omc/research/v0.2-redesign-plan.md`.
- **Consensus doc:** `.omc/plans/v0.2/CONSENSUS.md`.

## Next step

Autopilot was invoked, detected the v0.2 consensus, and skipped Phase 0 + Phase 1. It had just entered **Phase 2 (Execution)** and was about to start **Stage 0 `[v2-types]`** when the session was interrupted.

### How to resume

Option A (recommended — let autopilot drive):

```
/oh-my-claudecode:autopilot Resume claudit v0.2 rebuild. Consensus at `.omc/plans/v0.2/CONSENSUS.md` + primary `.omc/plans/v0.2/iteration-2/01-planner-revised.md`. Skip Phase 0+1. Resume Phase 2 at Stage 0 [v2-types]. Phase 4 MUST include CCG (Codex + Gemini via omc ask) — hard guardrail, no silent skip.
```

Option B (manual — go straight to Stage 0):
- Read `.omc/plans/v0.2/iteration-2/01-planner-revised.md` Stage 0 (lines 132-158).
- Implement `[v2-types]` changes, run `npm run typecheck && npm test`, commit with the prescribed stage message, push.
- Then move to Stage 1 `[v2-snapshot]` (Effort: L — the biggest stage).

## 12-stage pipeline (quick reference)

| Stage | Token | Effort | Status |
|-------|-------|--------|--------|
| 0 | `[v2-types]` | S | **PENDING — START HERE** |
| 1 | `[v2-snapshot]` | L | pending |
| 2 | `[v2-detector-hook-matcher]` | M | pending |
| 3 | `[v2-detector-namespace]` | M | pending |
| 4 | `[v2-detector-mcp]` | S | pending |
| 5 | `[v2-detector-path-binary]` | S | pending |
| 6 | (reserved) | — | skip |
| 7a | `[v2-report-base64]` | S | pending |
| 7b | `[v2-redaction-scanmd]` | M | pending |
| 8 | `[v2-e2e-flagship]` | M | pending |
| 9 | `[v2-ralph-verify]` | S | pending |
| 10 | `[v2-docs-polish]` | S | pending |
| 11 | `[v2-release]` | S | pending |

## Phase 4 validation — HARD REQUIREMENT

When Stage 8 completes, Phase 4 must include:
- Internal: `architect` + `security-reviewer` + `code-reviewer` (parallel)
- External: `omc ask codex` + `omc ask gemini` (parallel)

If external CLI unavailable → Phase 4 BLOCKED. No silent skip. See plan Section 5 (lines 506-602) for pre-check script, prompt templates, and fallback rules.

## Open reminders

- **v0.1 regression floor:** at least 100 of 109 v0.1 tests must pass without modification after the rewrite. Failing tests documented (not deleted) in `tests/v0.1-migration-notes.md`.
- **Stage 0 breaking change:** `PluginAgent.type → name` — global find-replace will break a couple of existing detector tests; update them in the same commit.
- **Working tree at pause:** clean except untracked `.omc/artifacts/` (CCG review logs), `.omc/project-memory.json`, `AGENTS.md`. Nothing blocking a fresh resume.

## Kill switch

To abort entirely and archive v0.2 work without executing: keep the plan commits (they document the research), delete `.omc/autopilot/` state files, and run `/oh-my-claudecode:cancel --force`.
