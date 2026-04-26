# Phase 2 — Improvement-spec synthesis (every terminal path)

Iterate's binding of **Step R2** in [`../../shared/retrospective.md`](../../../shared/retrospective.md). Runs first on every Done-X — before banner, before exit. Highest signal value comes from Done-Blocked / Done-TimedOut.

## 2a. Gate

```bash
SAFE_BRANCH=$(echo "$BRANCH" | tr '/' '-')
RETRO_FILES=$(ls -1 ".claude/retrospectives/$SAFE_BRANCH-iter-"*.md 2>/dev/null || true)
RETRO_COUNT=$(echo "$RETRO_FILES" | grep -c . || true)
```

Apply the shared **R2a** gate (skip when no retros, or every retro is the literal `_None — run was clean…_` line). When skipped, state file:
```
## Phase 2 — SKIPPED (no actionable retrospective signal)
```

## 2b. Synthesise

Apply shared **R2b** with these iterate-specific bindings passed into the synthesis prompt:
- `SKILL_TAG=iterate`
- `RUN_TAG=$SAFE_BRANCH` (covers all iterations of this run)
- `OUTCOME=<Done-Achieved|Done-Blocked|Done-TimedOut>`
- Branch / Iterate PR / Issue context
- Concatenate all `$SAFE_BRANCH-iter-N.md` in order (separated by `---`)

Capture as `IMPROVEMENT_SYNTHESIS`. The synthesis output already enforces the `iterate-improvement` + `self-improve:iterate` labels via shared R2b.

## 2c. Decision + dedupe + create

Run shared **R2c → R2d → R2e** in order. State file when an issue is created:
```markdown
## Phase 2 — IMPROVEMENT_FOUND
- New issue: <URL>
- Title: <…>   Labels: <…>
- Recursion: <will-recurse | skipped — see 2e>
```

When R2c reports `NO_IMPROVEMENT_FOUND`:
```markdown
## Phase 2 — NO_IMPROVEMENT_FOUND
- Justification: <verbatim>
- Retrospectives reviewed: <paths>
```
Skip 2e, banner.

## 2d. Cross-link to iterate PR

Apply shared **R2f** with the iterate PR number — comments `🔁 Phase 2 surfaced a follow-up improvement: <URL>` (using marker `<!-- iterate-followup -->`).

## 2e. Optional auto-recursion (gated)

Iterate is the **only** skill that opts into shared **R2g**. Auto-recurse ONLY when ALL hold:
- Loop ended **Done-Achieved**.
- `.claude/iterate-recursion-depth` missing OR contains `0`.
- New issue has `iterate-improvement` label (template enforces).

Off → banner line:
```
   Follow-up: <NEW_ISSUE_URL> — run `/iterate <NEW_ISSUE_NUMBER>` to deliver it.
```

On:
```bash
echo 1 > .claude/iterate-recursion-depth
```
Print:
```
   Follow-up: <NEW_ISSUE_URL>
   Auto-recursing into a fresh /iterate (recursion depth 1/1).
```
Invoke `iterate` skill with arg `<NEW_ISSUE_NUMBER>`. Recursive call sees depth=1 and refuses to recurse again at its own 2e. Outer skill exits after recursive call returns/errors.

**Cleanup contract (implemented in 0b):** delete depth marker if older than 24 h OR points at a missing branch.

---
