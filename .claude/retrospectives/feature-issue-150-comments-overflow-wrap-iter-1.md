# Retrospective — iterate-one-issue feature-issue-150-comments-overflow-wrap-iter-1 (PASSED)

<!-- retro-meta:
skill: iterate-one-issue
run:   feature-issue-150-comments-overflow-wrap-iter-1
outcome: PASSED
started: 2026-04-26T20:23:51Z
ended:   2026-04-26T21:30:00Z
-->

## Goal of this run
- Mode: issue   Goal: Satisfy all acceptance criteria of #150: Fix overflow-wrap in comments panel for long inline tokens   Issue: #150
- Bug-mode: true   Outcome: PASSED
- Commits ITER_BASE_SHA(c210dbc)..HEAD(737e4dc):
  - 73709be fix(iter-1): wrap long inline tokens in comment markdown — added overflow-wrap cascade on .comment-text in src/styles/comments.css mirroring #91; added e2e/browser/comment-overflow-wrap.spec.ts (4 viewports); on-disk fixture under e2e/browser/fixtures/comment-overflow-wrap/sample.md
  - 737e4dc fix(iter-1): remove unused fixture per expert review — deleted the on-disk fixture (architect-expert + test-expert flagged it as dead code; spec is self-contained via inline FILE_BODY served by the read_text_file IPC mock)
- Files touched (final): src/styles/comments.css (+26), e2e/browser/comment-overflow-wrap.spec.ts (+158)
- Forward-fix attempts: Step 6 = 0 (validation green first try; pre-existing NSIS-bundle infra failure ignored), Step 7 = 1 (the unused-fixture removal)
- Expert blocks: architect-expert (e2e/browser/fixtures/comment-overflow-wrap/sample.md unused — dead code rule 5); test-expert (same file unused — rule 21 fixtures should be read; rule 3/24 satisfied)
- Assessor confidence: pre-iter1 95% (all 7 R unmet); post-iter1 expected 100% achieved
- Iteration log entry verbatim (from .claude/iterate-state.md):
  ## Iteration 1 — PASSED
  - Commits: 73709be (fix + spec), 737e4dc (drop unused fixture per review)
  - Validate+CI: passed (local pre-existing NSIS-bundle infra failure ignored — needs prior `tauri build`); CI green twice
  - Expert review: 6 APPROVE / 2 BLOCK on iter-1a (architect, test — same nit: unused fixture); fixed in 1 commit; re-review 2 APPROVE → all 8 APPROVE
  - Goal assessor confidence: 95% (all 7 R unmet → all met after iter-1)
  - Summary: Mirror #91's overflow-wrap cascade onto .comment-text + new browser e2e at 4 viewports asserting page/panel no-scroll while fenced <pre> retains internal scroll. TDD-verified red→green via stash.

## What went well
- TDD path was clean: stashing src/styles/comments.css produced a red `e2e/browser/comment-overflow-wrap.spec.ts` (4 viewports failing on `pageOverflow ≤ 1`); unstashing turned it green on first run — a textbook docs/test-strategy.md rule 3 cycle.
- Single-commit fix landed the full 4-rule overflow-wrap cascade on `.comment-text` in src/styles/comments.css:127-156 mirroring exactly what cdddd1d shipped to `.markdown-body` for #91, so the fix is structurally identical to a precedent the codebase already trusts.
- Validation green first try (Step 6 forward-fix attempts = 0); local NSIS-bundle infra failure was correctly identified as pre-existing (needs prior `tauri build`) and ignored per validate-ci scope.
- Bug-expert RCA produced a single-component diagnosis (src/components/comments/CommentThread.tsx:130 + src/styles/comments.css:127-132) with a precise introduction history (0c01086f → fb17db9 → cdddd1d gap), which made the fix-direction obvious and avoided scope creep into MarkdownViewer.tsx.
- IPC-mock-driven spec (mirroring `e2e/browser/comment-on-csv.spec.ts` pattern with `__TAURI_IPC_MOCK__` + localStorage `mdownreview-ui v1` pre-seed) means the regression test is self-contained and stable — no fixture file dependency.

## What did not go well
- Iter-1a shipped an unused on-disk fixture `e2e/browser/fixtures/comment-overflow-wrap/sample.md`; the spec served the body inline via the `read_text_file` IPC mock, so the file was dead from commit 73709be. Both architect-expert (dead-code rule 5) and test-expert (rule 21: fixtures must be read) flagged it independently, costing a forward-fix commit (737e4dc) and a re-review cycle.
- The assessor pre-iter1 confidence reading "95% (all 7 R unmet)" is a contradiction — if all 7 requirements are unmet the confidence that they are met is 0%, not 95%. The number tracked the assessor's confidence in the *diagnosis*, not in the requirement-met status, but the iterate-state.md entry doesn't make that distinction.

## Root causes of friction
- **Unused fixture (forward-fix 737e4dc):** the implementer drafted both an on-disk fixture and an inline `FILE_BODY` mock body, then chose the inline path for stability but didn't delete the now-orphaned fixture. There is no exe-task-implementer pre-commit check that "every file added under `e2e/browser/fixtures/<spec-name>/` is referenced by the matching spec." docs/test-strategy.md rule 21 ("fixtures should be read by the spec that owns them") covers the *outcome* but doesn't trigger during authoring — only at expert-review time.
- **Confidence/met semantics:** `.claude/iterate-state.md` template uses one number ("Goal assessor confidence: N%") to mean two different things across runs (confidence-in-diagnosis vs confidence-requirements-met). No shared schema in `.claude/shared/` pins the meaning, so each iterate run picks its own interpretation.

## Improvement candidates (each must be specifiable)

### Lint e2e specs for orphaned fixture files
- **Category:** tooling
- **Problem (with evidence):** Iter-1a (commit 73709be) shipped `e2e/browser/fixtures/comment-overflow-wrap/sample.md` that no spec references; both architect-expert and test-expert blocked the iteration on it (dead-code rule 5 and test-strategy rule 21 respectively), forcing forward-fix commit 737e4dc and a full re-review cycle. There is no automated check that catches this before expert review.
- **Proposed change:** Add `scripts/check-e2e-fixtures.mjs` (Node) that walks `e2e/browser/fixtures/**` and `e2e/native/fixtures/**`, builds the set of fixture file paths, then greps every `e2e/**/*.spec.ts` for those basenames (or relative paths). Any fixture file with zero references → exit 1 with the orphan list. Wire into `package.json` `lint` script (or new `lint:e2e-fixtures`) and into CI via `.github/workflows/ci.yml` alongside the existing eslint step.
- **Acceptance signal:** Adding an unreferenced file under `e2e/browser/fixtures/foo/bar.md` then running `npm run lint` (or the new dedicated script) exits non-zero and prints the orphan path; deleting it returns to exit 0. CI fails on a PR that introduces an orphan.
- **Estimated size:** s
- **Confidence this matters:** medium — single recurrence so far, but it cost a real review cycle in this run and the check is cheap and permanent. Catches a class of issue (dead test infrastructure) that expert-review currently has to police manually.

### Pin the semantics of "Goal assessor confidence" in iterate-state.md
- **Category:** skill
- **Problem (with evidence):** The iter-1 log entry reads `Goal assessor confidence: 95% (all 7 R unmet → all met after iter-1)`. A 95% confidence paired with "all 7 requirements unmet" is internally inconsistent — the number is tracking diagnostic confidence, not requirement-met status, but the template doesn't distinguish. A future reader (or self-improvement loop synthesising across runs) cannot tell which the number means.
- **Proposed change:** In `.claude/skills/iterate-one-issue/SKILL.md` (and any referenced phase doc that prescribes the iterate-state.md row format), split the single line into two: `Assessor diagnosis-confidence: N%` and `Assessor requirements-met: M/T (X%)`. Update the iter-1 entry template + any examples. Add a one-line rubric in `.claude/shared/` (or in the skill itself) defining each term.
- **Acceptance signal:** A subsequent iterate run's `.claude/iterate-state.md` entry contains both fields with non-contradictory values; grep across `.claude/retrospectives/*.md` for "Goal assessor confidence" finds zero new occurrences after the change.
- **Estimated size:** xs
- **Confidence this matters:** low — single occurrence, no reviewer was actually misled this run; but the cost to fix is trivial and it removes ambiguity in a log that downstream synthesis tools read.

## Carry-over to the next run
- None — fix is fully landed, all 8 expert agents APPROVE on iter-1b, CI green twice. The two improvement candidates above are independent of #150's PR.

## BUG_RCA

**1. Reproduction.** Open the app at viewport ≤1280 px wide with the comments panel visible (`commentsPaneVisible: true` in `mdownreview-ui` v1 localStorage). Add a comment whose body contains a long unbroken inline token (e.g. a 200-char hex string or URL with no breakable characters). The comment renders via `src/components/comments/CommentThread.tsx:130` as `<div className="comment-text"><ReactMarkdown>...</ReactMarkdown></div>`. Result: the comment text overflows the panel horizontally, forcing horizontal scroll on the page (`pageOverflow > 1`) and on the panel body (`bodyOverflow > 1`).

**2. Root cause.** `src/styles/comments.css:127-132` defines `.comment-text` with only `font-size`, `line-height`, `margin`, and `white-space: pre-wrap`. It is missing the four wrap rule groups added in #91 to `.markdown-body` (overflow-wrap/word-break cascade for inline content, fenced-block scroll containment, table overflow, and image max-width). Because `.comment-text` is not nested inside `.markdown-body`, none of #91's rules apply transitively.

**3. Introduction.** `.comment-text` was added in commit 0c01086f (initial commit) with no wrap rules. Markdown rendering of the comment body was added in fb17db9 ("auto-improve: render comment text as markdown") but did not extend the wrap cascade to `.comment-text`. #91 (commit cdddd1d) fixed only `.markdown-body`, leaving the comments-panel surface unprotected.

**4. Test gap.** `e2e/browser/markdown-overflow-wrap.spec.ts` line 47 deliberately sets `commentsPaneVisible: false`, so the existing geometry-based regression spec for #91 never exercises the comments panel surface. No other browser or native test asserts geometry on the comments panel. Per `docs/test-strategy.md` rule 3, every bug fix needs a regression test that first fails — none existed for this surface.

**5. Regression-test plan.** New spec `e2e/browser/comment-overflow-wrap.spec.ts`, browser layer, parametrised over 600 / 900 / 1280 / 1920 px viewports. Asserts `pageOverflow ≤ 1`, `bodyOverflow ≤ 1`, and `preInternalScroll > 0` (i.e. fenced `<pre>` retains its internal horizontal scroll instead of bleeding into the page). Comment is seeded via `__TAURI_IPC_MOCK__` (mirroring the pattern in `e2e/browser/comment-on-csv.spec.ts`); localStorage is pre-seeded with `mdownreview-ui` v1 carrying `commentsPaneVisible: true`, `commentsPaneWidth: 360`, `folderPaneWidth: 80`.

**6. Fix direction.** Append the four rule groups from `src/styles/markdown.css` (the #91 cascade) to `src/styles/comments.css`, scoped to `.comment-text` and its descendants. Add `.comment-text pre { overflow: auto }` because there is no `.markdown-body` ancestor to donate the fenced-block scroll containment.

**7. Adjacent risk.** `.md-comment-popover` also renders `CommentThread`, so it inherits the `.comment-text` fix transitively — verified by visual inspection, no separate change needed. Other `ReactMarkdown` surfaces (`MarkdownViewer.tsx`, etc.) all use `.markdown-body` and were already fixed by #91. No other surfaces need work in this PR.
