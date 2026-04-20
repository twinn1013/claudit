# Architect Review — Iteration 1

## Verdict: APPROVE_WITH_CONCERNS

## Steelman Antithesis

Static file analysis may not match runtime plugin resolution. Claudit is a static analyzer for a dynamic system whose behavior is undocumented. The Claude Code runtime may apply ordering, priority, or de-duplication logic that differs from what claudit infers by file enumeration, producing false positives (for collisions the runtime already handles) and false negatives (for collisions the runtime creates through merging).

Concrete example: Vercel hook uses matcher `"startup|resume|clear|compact"`, OMC uses `"*"`. If runtime evaluates in plugin-install order, claudit cannot know ordering without runtime introspection.

## Tensions

### Tension 1: Content-Aware Fidelity vs Latency Budget
- P3 (all 6 content-aware) × P5 (<200ms PostToolUse:Bash) directly conflict
- Content-aware hook analysis = read + parse 20-50 files = impossible in 200ms
- **Synthesis:** Split into trigger + deferred scan. PostToolUse does only regex matching + writes pending marker. Actual scan runs via SessionStart or background timer in <500ms budget.

### Tension 2: OMC-Independence vs Real Testing
- P4 (OMC-independent) × practical E2E requires multi-plugin environments
- **Synthesis:** Use `tests/fixtures/` replicating OMC/Vercel file layouts. Dependency-inject root path into Snapshot constructor. Testing *against* OMC ≠ depending *on* OMC.

### Tension 3: Slash Command vs Skill Registration
- Commands use `plugin.json "commands": [...]` (Vercel pattern)
- Skills use `plugin.json "skills": "./skills/"` (OMC pattern)
- Plan mixes both terms
- **Synthesis:** Register as **command** (manual-trigger). Drop "skill" nomenclature.

## Principle Violations

| Principle | Status | Note |
|-----------|--------|------|
| P1 never mutate | ✓ | Read-only by design |
| P2 pluggable modules | ✓ | Common interface present |
| P3 all 6 content-aware | **At risk** | Stage 11 as-written cannot fit in 200ms |
| P4 OMC-independent | ✓ | No OMC imports |
| P5 latency bounded | **At risk** | See Tension 1 |

## Guardrail Check

- G1 commits: stage tokens good; plan must add boilerplate commit+push to each stage
- G2 /ccg: Stages 2, 11 correct. Open Q4/Q5/Q7 contradict themselves (listed as "resolved" AND "/ccg required")
- G3 stop: 15-stage decomposition localizes failure ✓
- G4 ralph-verify:
  - install: doesn't verify hooks.json at convention path
  - namespace: should check commands registry too, not only skills
  - idempotency: strongest part

## Architectural Concerns

1. **hooks.json schema:** `{"hooks": {"<EventType>": [{"matcher":..., "hooks":[{"type":"command", "command":..., "timeout":N}]}]}}`. No plugin declares hooks in plugin.json; convention path = `hooks/hooks.json`.
2. **$CLAUDE_PLUGIN_ROOT** standard env var. Pick `$X` or `${X}` consistently.
3. **Snapshot scope:** Miss project-level `.claude/` (contains project hooks/permissions). Add `projectRoot` param to Snapshot.
4. **Detector execution:** Must be `Promise.allSettled()` + per-detector timeout (~100ms). Errors → Collision{category:"internal-error"}.
5. **Report delivery:** Hook stdout JSON `{"additionalContext": "<claudit-report>JSON</claudit-report>"}`, NOT just "JSON + XML wrapper".
6. **Current plugin.json** has no commands/skills/hooks fields. Stage 1 must add.

## 8 Recommended Revisions

1. Stage 11: split trigger + deferred scan (resolves P5 violation)
2. Stage 2: expand /ccg scope to include hook stdout JSON shape
3. Stage 3: add projectRoot to Snapshot constructor
4. Stage 10: Promise.allSettled + per-detector timeout explicit
5. Stage 13: register as command (plugin.json `commands: [...]`), drop skill nomenclature
6. Stage 1: add commands + hooks convention notes
7. Plan-wide: add commit+push boilerplate to each stage
8. Open Q4/Q5/Q7: resolve contradiction between "resolved" and "/ccg required"
