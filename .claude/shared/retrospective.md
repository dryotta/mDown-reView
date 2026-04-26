# Shared: post-run retrospective + self-improvement issue

Used by every fully autonomous skill (`iterate`, `test-exploratory-e2e`, `test-exploratory-loop`). Provides:
1. A uniform retrospective markdown structure.
2. A uniform "create a GitHub improvement issue if warranted" handoff so all autonomous skills feed the same self-improvement backlog under one label.

If you are an autonomous skill, run this **at the end of every run** — including degraded, blocked, and timed-out runs. Highest signal usually comes from imperfect runs.

---

## Step R1 — Write the retrospective file

Path:
```bash
RETRO_DIR=".claude/retrospectives"
mkdir -p "$RETRO_DIR"
SKILL_TAG="<skill-name>"          # e.g. iterate, test-exploratory-e2e, test-exploratory-loop
RUN_TAG="<short-stable-id>"       # e.g. issue-42-iter-3, run-2026-04-26T10-30Z, loop-2026-04-26T10-30Z
RETRO_FILE="$RETRO_DIR/$SKILL_TAG-$RUN_TAG.md"
```

Generate the file via a `general-purpose` sub-agent. **Concrete only — every bullet cites file:line, agent name, commit SHA, log line, rule, or quoted error.** Vague retros are worse than none.

```markdown
# Retrospective — <SKILL_TAG> <RUN_TAG> (<OUTCOME>)

<!-- retro-meta:
skill: <SKILL_TAG>
run:   <RUN_TAG>
outcome: <PASSED|DEGRADED|BLOCKED|TIMED-OUT>
started: <ISO>
ended:   <ISO>
-->

## Goal of this run
<one sentence — verbatim requirements / persona seed / loop spec>

## What went well
- <concrete bullet>

## What did not go well
- <concrete: which agent, which rule, which file, which assertion, which heuristic>

## Root causes of friction
For each problem above, the underlying cause. Cite docs/X.md rules where one could be tightened.

## Improvement candidates (each must be specifiable)
For each candidate use this template — Step R2 must lift directly into a `<!-- mdownreview-spec -->` body without re-investigation:

### <short imperative title>
- **Category:** process | tooling | test-strategy | architecture | docs | skill | agent | bug
- **Problem (with evidence):** <2-3 sentences citing file:line, agent, log, SHA>
- **Proposed change:** <concrete diff sketch — paths, what to add/remove, what to assert>
- **Acceptance signal:** <measurable, observable>
- **Estimated size:** xs | s | m | l
- **Confidence this matters:** low | medium | high (one-line justification)

If no candidate, write literally: `_None — run was clean and adds no signal for self-improvement._`

## Carry-over to the next run
<bullets; empty if none>
```

Skill-specific extensions are allowed (e.g. iterate adds `## BUG_RCA` for bug-mode iterations) — append after `## Carry-over`, never reorder the headings above.

Persistence rules:
- **iterate**: commit + push the retro on the iterate branch (so it lands in the PR diff).
- **test-exploratory-e2e**: write to `runs/<run-id>/retrospective.md` AND `.claude/retrospectives/`. The run folder is gitignored; the second copy persists via Step R2.
- **test-exploratory-loop**: one retro per outer loop run, summarising the per-iteration `loop.md` digests.

---

## Step R2 — Create / append a self-improvement issue

### R2a. Gate

Skip R2 when:
- The retro contains no `### <title>` candidates (i.e. it has the literal `_None — run was clean…_` line and nothing else under `## Improvement candidates`).
- For multi-iteration skills (iterate, test-exploratory-loop): every retro from the run is in that empty state.

When skipped, log:
```
[<SKILL_TAG>] retrospective: no actionable improvement candidates — Step R2 skipped.
```
Exit Step R cleanly.

### R2b. Synthesise

Single `general-purpose` call. Pass every retro file content verbatim + the run's terminal status.

```
Synthesise <SKILL_TAG> retrospective(s) into ONE follow-up improvement spec.
Run terminated as: <PASSED|DEGRADED|BLOCKED|TIMED-OUT>
Skill: <SKILL_TAG>   Run: <RUN_TAG>   Branch/PR (if any): <…>

Retros (verbatim, in order, '---' separated):
<concatenated retro contents>

Pick the SINGLE highest-leverage candidate meeting ALL:
1. Recurs across >=2 retros, OR appears once with high-confidence + l/m size, OR is a `bug`/`agent`/`skill` candidate the skill itself hit.
2. Source retros have enough specificity (file:line, agent, rule, log) to draft a concrete spec.
3. In scope: .claude/skills/, .claude/agents/, .claude/shared/, docs/*.md, src/, src-tauri/, e2e/, .github/workflows/.
4. Not duplicating an open issue. Verify:
     gh issue list --state open --label iterate-improvement --search "<keywords>" --limit 20
   Also search without the label filter for broader matches.

If NO candidate clears all four, output exactly:
NO_IMPROVEMENT_FOUND
<one-paragraph justification>

Otherwise output exactly this template — no preamble, no extra commentary:

ISSUE_TITLE: <imperative, <=70 chars>
ISSUE_LABELS: <comma-separated; ALWAYS includes `groomed` and `iterate-improvement`; ALWAYS includes `self-improve:<SKILL_TAG>`; PLUS exactly one of {process, tooling, test-strategy, architecture, docs, skill, agent, bug}>
ISSUE_BODY:
<problem statement, 1-2 paragraphs, citing retro file paths>

## Why this matters
<1 paragraph linking to docs/principles.md pillar(s)>

## Evidence from retrospectives
<bullets, each quoting retro verbatim + file>

## Source run
- Skill: <SKILL_TAG>
- Run: <RUN_TAG>
- Outcome: <…>
- Surfaced via: <link to PR / run folder / loop digest>

SPEC_BODY:
<body of `<!-- mdownreview-spec -->` comment — self-contained for fresh /iterate-one-issue run>

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

Capture as `IMPROVEMENT_SYNTHESIS`.

### R2c. Decision

If `IMPROVEMENT_SYNTHESIS` starts with `NO_IMPROVEMENT_FOUND`:
```
[<SKILL_TAG>] retrospective: NO_IMPROVEMENT_FOUND — <verbatim justification>
```
Exit Step R.

Otherwise parse `ISSUE_TITLE`, `ISSUE_LABELS`, `ISSUE_BODY`, `SPEC_BODY`.

### R2d. Dedupe across past runs

Before creating a new issue, check whether a recent autonomous-skill run already filed something equivalent:

```bash
EXISTING=$(gh issue list --state open --label "iterate-improvement" --search "$ISSUE_TITLE in:title" \
  --json number,title,url --limit 5 | jq '.[0] // empty')
```

If an open issue with a near-identical title (case-insensitive substring or >=80% token overlap) exists:

```bash
gh issue comment "$EXISTING_NUMBER" --body "$(cat <<EOF
<!-- self-improve-reproduced -->
Reproduced by **<SKILL_TAG>** run <RUN_TAG> (outcome: <OUTCOME>).

Latest evidence:
<bullets quoting the new retro>

Retro: <link to retro file in repo / run folder>
EOF
)"
```

Then exit Step R — do **not** create a duplicate.

### R2e. Create the issue

```bash
NEW_ISSUE_URL=$(gh issue create \
  --title "$ISSUE_TITLE" \
  --label "$ISSUE_LABELS" \
  --body "$(printf '%s\n\nSurfaced by **%s** run %s (outcome: %s).\n\n%s' \
              "$ISSUE_BODY" "$SKILL_TAG" "$RUN_TAG" "$OUTCOME" \
              "<links to each retro file>")")
NEW_ISSUE_NUMBER=$(echo "$NEW_ISSUE_URL" | grep -oE '[0-9]+$')

gh issue comment "$NEW_ISSUE_NUMBER" --body "$(cat <<EOF
<!-- mdownreview-spec -->
$SPEC_BODY
EOF
)"
```

The `iterate-improvement` label means the next `/iterate-loop` sweep will pick this issue up automatically (per `iterate-loop` Step 1 selection). The `self-improve:<SKILL_TAG>` sub-label lets humans filter by source skill.

### R2f. Cross-link

If the run produced a PR (iterate only), comment on it:
```bash
gh pr comment <PR_NUMBER> --body "<!-- self-improve-followup -->
🔁 Retrospective surfaced a self-improvement: $NEW_ISSUE_URL"
```

For test-exploratory-e2e / -loop: log the URL to the run folder's `loop.md` / final report so a human reading the run can find it.

### R2g. Optional auto-recursion

Off by default. Only `iterate-one-issue` opts in (with the `.claude/iterate-recursion-depth` safeguard documented in `.claude/skills/iterate-one-issue/references/phase-2.md`). Other skills must NOT auto-recurse.

---

## Required labels (one-time setup)

Idempotent — re-run any time:

```bash
gh label create "iterate-improvement" --color "5319E7" --description "Self-improvement candidate surfaced by an autonomous skill" --force
gh label create "self-improve:iterate"               --color "C2E0C6" --force
gh label create "self-improve:test-exploratory-e2e"  --color "C2E0C6" --force
gh label create "self-improve:test-exploratory-loop" --color "C2E0C6" --force
```

---

## Banner line for autonomous skills

After Step R completes, every autonomous skill prints one of:

```
🔁 Self-improve: <NEW_ISSUE_URL> (<category>)
🔁 Self-improve: reproduced existing issue #<N>
🔁 Self-improve: NO_IMPROVEMENT_FOUND
🔁 Self-improve: skipped (no actionable candidates)
```

so logs across skills are greppable for the same prefix.
