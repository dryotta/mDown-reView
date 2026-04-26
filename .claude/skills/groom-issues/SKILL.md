---
name: groom-issues
description: Use when the user runs `/groom-issues`, asks to "groom", "spec out", or "process the needs-grooming backlog" of GitHub issues, or pastes issue numbers asking for grooming. Two-phase pipeline (interactive Phase A → autonomous Phase B).
---

# Groom Issues

Two-phase pipeline. Run Phase A to completion across **all** targeted issues before starting Phase B.

- **Phase A — Clarify (interactive).** Sweep every issue, collect every answer the user owes. Invoke `superpowers:brainstorming` for complex issues. Phase A writes nothing to GitHub and produces no specs.
- **Phase B — Spec (autonomous).** No questions to the user. Per issue: draft spec → consult expert agents → resolve every comment → post/update GitHub.

The cache directory `.groom-cache/` is the contract between phases — Phase B reads only the cache and the issue. Once Phase B starts, do not prompt the user.

## Charter alignment

Each issue is judged against `docs/principles.md` (5 pillars + Non-Goals). An issue mapping to a Non-Goal is flagged in Phase A and closed instead of groomed unless the user overrides.

When proposing approaches, cross-check `docs/architecture.md`, `docs/performance.md`, `docs/security.md`, `docs/design-patterns.md`, `docs/test-strategy.md`. If the natural approach violates a rule, either pick a different approach or include a rule-change proposal in the spec — never silently bypass.

## Input parsing

| Invocation | Target Issues |
|---|---|
| `/groom-issues #36 #42` or `/groom-issues 36 42` | the listed numbers, regardless of labels |
| `/groom-issues` | all open issues with the `needs-grooming` label |

## Labels

| Label | Meaning |
|---|---|
| `needs-grooming` | Ungroomed, or re-queued for re-grooming |
| `groomed` | Spec attached, ready to implement |

To re-groom: remove `groomed`, add `needs-grooming`. The skill finds and updates the existing spec via the `<!-- mdownreview-spec -->` marker.

## Step 0 — Setup

```bash
gh label create "needs-grooming" --description "Issue needs grooming / spec generation" --color "FBCA04" --force
gh label create "groomed" --description "Issue has been groomed with a spec attached" --color "0E8A16" --force
mkdir -p .groom-cache
grep -qxF '.groom-cache/' .gitignore 2>/dev/null || echo '.groom-cache/' >> .gitignore
```

## Step 1 — Collect queue

Fetch issues per the input parsing rules. If the default mode finds none, report:

> "No issues with `needs-grooming` label found. Add the label or pass numbers: `/groom-issues #36 #42`"

…and exit. Otherwise sort ascending and print:

```
Issues to groom:
  #36 — CLI improvements
  #42 — Add export feature

Phase A: clarifying all issues. No specs written until Phase A completes.
```

# Phase A — Clarify (interactive)

For each issue, in order:

### A1. Show context
Print the issue header, body, and the most recent comments. Flag if a `<!-- mdownreview-spec -->` comment already exists (re-groom — show the prior spec).

### A2. Explore codebase
Read the files and modules the issue touches. The goal is precision: enough understanding to ask sharp questions and recognize ambiguity.

### A3. Triage complexity

| Signal | Path |
|---|---|
| Single component, clear ask, ≤3 unknowns | A4 — inline Q&A |
| Cross-cutting, ambiguous goal, multiple plausible approaches, or rule-change implications | A4 — invoke `superpowers:brainstorming` |

Decide before the first question. Brainstorming is not a fallback if inline goes badly — pick once.

### A4. Clarify

**Inline path:** ask 1–6 questions, one at a time, using `ask_user` with multiple choice where it fits. Cover requirements, constraints, edge cases, success criteria, pillar fit, Non-Goal check.

**Brainstorming path:** invoke `superpowers:brainstorming` scoped to this single issue. Capture the brainstorming output verbatim for the cache.

### A5. Cache

Write `.groom-cache/<issue-number>.md`:

```markdown
# Issue #<n> — <title>

## User answers
<verbatim Q&A or brainstorming output>

## Codebase notes
<key files, current behavior>

## Pillar impact
<pillars strengthened/risked, or "Non-Goal — close" decision>

## Chosen approach
<one paragraph, agreed with the user>

## Open items deferred to expert review
<items the user explicitly delegated to Phase B>
```

Print: `cached → .groom-cache/<n>.md`

### A6. Phase A handoff

After the last issue, print:

```
Phase A complete. Cached:
  - .groom-cache/36.md
  - .groom-cache/42.md

Edit any cache file if you want to revise. Reply 'go' to start autonomous Phase B, or 'stop' to halt.
```

Wait for the user's `go`. This is the last interactive checkpoint. Without `go`, do not enter Phase B.

# Phase B — Spec (autonomous)

No prompts to the user. For each cached issue, in order:

### B1. Draft spec
Read the cache file. Produce a draft using the spec template below, leaving `### Expert feedback resolution` empty for now.

### B2. Consult expert agents

Dispatch the relevant subset **in parallel** (single message, multiple `Agent` tool calls — see `superpowers:dispatching-parallel-agents`). Pick generously; missed reviewers are more expensive than redundant ones.

| Agent | Trigger |
|---|---|
| `architect-expert` | Layering, IPC contract, store design, separation of concerns |
| `documentation-expert` | Any user-facing change or new feature area |
| `lean-expert` | New deps, new files, new abstractions, binary-size impact |
| `performance-expert` | Rendering, watcher, large-file handling, IPC volume |
| `product-improvement-expert` | New feature or UX change |
| `react-tauri-expert` | React hooks, Tauri plugins, IPC, version-specific APIs |
| `security-reviewer` | `src-tauri/src/`, file IO, markdown rendering, capability changes |
| `test-expert` | Any source-code change |

Each agent receives: the draft spec, the issue body, and the cache file. Ask each for blocking concerns, recommended changes, and missing acceptance criteria. Cap each agent's response with "Reply in under 250 words."

### B3. Resolve every comment

Merge feedback into the spec. Each comment must land in one of three buckets — never silently dropped:

- **Incorporate** — change the spec to reflect it.
- **Defer** — record in `### Open Questions` with rationale.
- **Reject** — record in `### Expert feedback resolution` with reason.

### B4. Post or update GitHub

If a `<!-- mdownreview-spec -->` comment exists (re-groom):
```bash
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
gh api repos/$REPO/issues/comments/<comment-id> -X PATCH -f body="<spec>"
```
Otherwise:
```bash
gh issue comment <number> --body "<spec>"
```

Update labels and clear the cache:
```bash
gh issue edit <number> --remove-label "needs-grooming" --add-label "groomed"
rm .groom-cache/<number>.md
```

Print: `#<n> groomed — spec posted, labeled groomed.`

### B5. Final summary

```
Grooming session complete:
  #36 — CLI improvements (3 expert comments incorporated, 1 deferred)
  #42 — Add export feature (5 incorporated)
```

## Spec template

```markdown
<!-- mdownreview-spec -->
## Specification for #<number>: <title>

### Problem Statement
<What problem does this solve? Who is affected?>

### Pillar impact
<Pillars strengthened; pillars at risk. See docs/principles.md.>

### Proposed Approach
<Chosen approach with enough detail to implement.>

### Acceptance Criteria
- [ ] ...

### Technical Notes
<Key files, architectural considerations. Cite rules from docs/architecture.md, docs/performance.md, docs/security.md, docs/design-patterns.md, docs/test-strategy.md where relevant.>

### Constraints & Non-Goals
<Explicitly out of scope.>

### Rule-change proposals
<If implementation would violate a deep-dive rule, propose the change here. Otherwise "None".>

### Expert feedback resolution
<For each expert comment: status (incorporated / deferred / rejected) + one-line reason. "None" if no comments.>

### Open Questions
<Remaining unknowns or "None".>

---
*Spec generated by `/groom-issues`. To re-groom: remove `groomed`, add `needs-grooming`.*
```

## Notes

- Specs live as issue comments, not in the repo — they travel with the issue.
- The `<!-- mdownreview-spec -->` marker is invisible in rendered markdown but lets the skill find and update on re-groom.
- `gh label create --force` is idempotent.
- This skill produces issue-level specs only. Implementation planning happens in `superpowers:writing-plans`.
