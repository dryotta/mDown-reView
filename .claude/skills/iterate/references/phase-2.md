## Phase 2 — Improvement-spec synthesis (every terminal path)

Runs first on every Done-X — before banner, before exit. Highest signal value comes from Done-Blocked / Done-TimedOut.

### 2a. Gate
```bash
SAFE_BRANCH=$(echo "$BRANCH" | tr '/' '-')
RETRO_FILES=$(ls -1 ".claude/retrospectives/$SAFE_BRANCH-iter-"*.md 2>/dev/null || true)
RETRO_COUNT=$(echo "$RETRO_FILES" | grep -c . || true)
```

Skip Phase 2 (go to terminal banner) if:
- `RETRO_COUNT == 0`, OR
- Every retro contains literally `_None — iteration was clean and adds no signal for Phase 2._` and nothing else under "Improvement candidates".

When skipped: state file `## Phase 2 — SKIPPED (no actionable retrospective signal)`.

### 2b. Synthesise

`general-purpose` (single call). Pass every retro file content verbatim + terminal status.

```
Synthesise iterate-loop retros into ONE follow-up improvement spec.
Loop terminated as: <Done-Achieved|Done-Blocked|Done-TimedOut>
Branch: <BRANCH>   Iterate PR: <URL>   Issue: #<ISSUE_NUMBER>
Total retros: <RETRO_COUNT>

Retros (verbatim, in order, '---' separated):
<concatenated $SAFE_BRANCH-iter-N.md>

Pick the SINGLE highest-leverage candidate meeting ALL:
1. Recurs across ≥2 retros, OR appears once with high-confidence + l/m size, OR is a `bug`/`agent`/`skill` candidate the loop itself hit.
2. Source retros have enough specificity (file:line, agent, rule, log) to draft a concrete spec.
3. In scope: iterate skill, .claude/agents/, docs/*.md, src/, src-tauri/, e2e/, .github/workflows/.
4. Not duplicating an open issue. Verify: `gh issue list --state open --search "<keywords>" --limit 20`.

If NO candidate clears all four, output exactly:
NO_IMPROVEMENT_FOUND
<one-paragraph justification>

Otherwise output exactly this template — no preamble, no extra commentary:

ISSUE_TITLE: <imperative, ≤70 chars>
ISSUE_LABELS: <comma-separated; from {groomed, iterate-improvement} + exactly one of {process, tooling, test-strategy, architecture, docs, skill, agent, bug}>
ISSUE_BODY:
<problem statement, 1-2 paragraphs, citing retro file paths>

## Why this matters
<1 paragraph linking to docs/principles.md pillar(s)>

## Evidence from retrospectives
<bullets, each quoting retro verbatim + file>

SPEC_BODY:
<body of `<!-- mdownreview-spec -->` comment — self-contained for fresh /iterate run>

# <ISSUE_TITLE>

## Goal
<one sentence, observable>

## Acceptance criteria
- [ ] <specific, measurable, file/path-cited>
- [ ] …
- [ ] Regression test (if behaviour change): <file path, layer, assertion>

## Files likely to change
<bullets>

## Out of scope
<bullets>

## Notes
<constraints — e.g. "must not regress test-strategy.md rule 5">
```

Capture `IMPROVEMENT_SYNTHESIS`.

### 2c. Decision

Begins with `NO_IMPROVEMENT_FOUND`:
```markdown
## Phase 2 — NO_IMPROVEMENT_FOUND
- Justification: <verbatim>
- Retrospectives reviewed: <paths>
```
Append, skip 2d/2e, banner.

Else parse `ISSUE_TITLE`, `ISSUE_LABELS`, `ISSUE_BODY`, `SPEC_BODY`.

### 2d. Create issue + spec

```bash
NEW_ISSUE_URL=$(gh issue create \
  --title "$ISSUE_TITLE" \
  --label "$ISSUE_LABELS" \
  --body "$(printf '%s\n\nSurfaced by /iterate retrospectives on PR <PR_URL>.\n\n%s' "$ISSUE_BODY" "<links to each retro file in PR>")")
NEW_ISSUE_NUMBER=<parsed>

gh issue comment "$NEW_ISSUE_NUMBER" --body "$(cat <<EOF
<!-- mdownreview-spec -->
$SPEC_BODY
EOF
)"

gh pr comment <PR_NUMBER> --body "<!-- iterate-followup -->
🔁 Phase 2 surfaced a follow-up improvement: $NEW_ISSUE_URL"
```

State file:
```markdown
## Phase 2 — IMPROVEMENT_FOUND
- New issue: <URL>
- Title: <…>   Labels: <…>
- Recursion: <will-recurse | skipped — see 2e>
```

### 2e. Optional auto-recursion (gated)

Auto-recurse ONLY when ALL hold:
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
