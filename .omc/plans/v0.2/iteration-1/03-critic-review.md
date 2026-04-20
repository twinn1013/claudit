# Critic Review — Iteration 1

## Verdict: ITERATE

## Overall Assessment

The plan is structurally sound: 10 stages, binary exit criteria, good ground-truth traceability. The Architect's 5 revisions are all valid and I endorse them without modification. However, I found 3 additional issues the Architect missed — two MAJOR, one MINOR — plus gaps in the areas specifically flagged for scrutiny.

## Architect Revisions: Endorsed

R1–R5 from `02-architect-review.md` are all correct. Carry them forward verbatim into iteration-2.

## New Findings

### MAJOR-C1: CCG guardrail has no fallback behavior

Section 5 (Phase 4 validation protocol) says `omc ask codex` and `omc ask gemini` but specifies zero fallback if one CLI is unavailable (Codex requires a separate npm install; Gemini requires API key setup). No prompt template is provided — just prose. The executor cannot distinguish "Codex found no issues" from "Codex CLI was not installed and the command silently failed."

- **Confidence:** HIGH
- **Fix:** Add explicit pre-check (`which codex || ...`), a concrete prompt template (not prose), and a fallback rule: "If either external reviewer is unavailable, the review MUST be performed manually by a human or the stage is blocked. Do not skip."

### MAJOR-C2: Redaction covers 4 patterns; real-world secrets are broader

The 4 patterns (`?token=`, `Authorization: Bearer`, `*_SECRET=`/`*_KEY=`, `--password`/`--auth-token`) miss at least:
- `npm config set //registry.npmjs.org/:_authToken=...` (npm publish token leakage)
- SSH private key paths passed as `-i /path/to/id_rsa`
- `AWS_ACCESS_KEY_ID=AKIA...` (doesn't match `*_SECRET=` or `*_KEY=` — it's `*_KEY_ID=`)
- Git credential URLs: `https://user:token@github.com/...`

The plan says patterns are "extensible via `policies.ts`" but doesn't commit to a minimum coverage set that exit criteria verify. Stage 6 exit criteria test exactly 3 patterns — they don't even test all 4 listed patterns (`--password` is absent).

- **Confidence:** HIGH
- **Fix:** (a) Add `_authToken=`, git credential URLs (`https?://[^@]+@`), and `AWS_ACCESS_KEY_ID` to the pattern list. (b) Add exit criteria for all patterns including negative tests. (c) Acknowledge in Limitations that the list is non-exhaustive.

### MAJOR-C3: scan.md lacks namespace-ambiguity directive

Current `scan.md` says for `possible` confidence, "warrants review." But when two plugins both register `/scan` and claudit reports `info/possible`, Claude needs a specific instruction: "Do NOT recommend uninstalling either plugin. State that both work and the user should use the prefixed form." Without this, Claude's default helpfulness may suggest removing one. None of the 7 planned directives address namespace ambiguity specifically.

- **Confidence:** HIGH
- **Fix:** Add directive 8 to `scan.md`: "For collisions with `category: slash-command|skill-name|subagent-type` and `severity: info`, do NOT suggest uninstalling or disabling either plugin. Instead explain the prefix disambiguation syntax."

### MINOR-C4: Conservative redaction tradeoff not explicitly owned

Q3 explains why conservative beats aggressive but doesn't state the consequence: conservative redaction WILL produce false negatives (real secrets in non-matching patterns land on disk unredacted). The Limitations section does not mention redaction false negatives. Documentation gap, not a design flaw.

- **Fix:** Add a sentence to Limitations acknowledging the pattern list is non-exhaustive and unknown secret formats pass through unredacted.

## What's Missing

- **v0.1 test survival estimate:** Plan says "109 existing" tests carry forward but never estimates how many break from the snapshot rewrite. Architect R4 adds a regression criterion; plan should also commit to a floor (e.g., "at least 100 of 109 v0.1 tests pass without modification; remainder are updated, not deleted").
- **Cross-source matcher overlap in Stage 2 exit criteria:** Tests same-source overlaps (`"Edit|Write"` vs `"Edit"`) but not the cross-source case where user `settings.json` hook has matcher `"*"` and a plugin hook has `"Bash"`. This is the actual rtk scenario shape.
- **Stage ordering (confirmatory):** Architect R1 (types.ts changes) must precede Stage 1 snapshot rewrite since snapshot.ts imports from types.ts. Confirming, not adding.

## Consolidated Revision List for Iteration-2

**From Architect (R1–R5):**
1. Remove `types.ts` from UNTOUCHED; add type evolution to Stage 0 or Stage 1.
2. Add YAML parse-warning negative test to Stage 1 exit criteria.
3. Split Stage 6 into 6a (base64) and 6b (redaction + FixSuggestion + scan.md).
4. Add v0.1 regression criterion to ralph-verify (test count floor).
5. Clarify `session-start.ts` UNTOUCHED claim re: new SnapshotData fields.

**From Critic (C1–C4):**
6. CCG guardrail: pre-check, prompt template, explicit fallback-blocked rule.
7. Redaction: expand to 7+ patterns, add exit criteria for all, add Limitation note for false negatives.
8. scan.md: add directive 8 for namespace-ambiguity collisions (no uninstall suggestion).
9. Commit to v0.1 test survival floor in ralph-verify.

## Guardrail Compliance

- Stage commits + no AI attribution: PASS
- /ccg gating: PASS (zero flags, appropriate)
- Phase 4 CCG guardrail: **PARTIAL PASS** — present but needs MAJOR-C1 fixes before executor can rely on it
- ralph-verify rigor: PARTIAL PASS — good new criteria, missing regression + survival floor

## Verdict Justification

ITERATE. No CRITICAL findings — the plan's architecture and ground-truth traceability are solid. Three MAJOR findings (CCG fallback, redaction coverage, scan.md namespace directive) require concrete additions affecting exit criteria and deliverables. Additive gaps, not systemic flaws. Realist check confirmed: all three MAJORs have real-world consequences (leaked secrets, wrong Claude advice, silently skipped external review).
