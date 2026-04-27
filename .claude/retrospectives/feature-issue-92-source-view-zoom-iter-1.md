# Retrospective — iterate-one-issue feature-issue-92-source-view-zoom-iter-1 (PASSED)

<!-- retro-meta:
skill: iterate-one-issue
run:   feature-issue-92-source-view-zoom-iter-1
outcome: PASSED
started: 2026-04-26T15:45:16-07:00
ended:   2026-04-26T16:05:51-07:00
-->

## Goal of this run
Satisfy all acceptance criteria of #92: zoom feature doesn't work in Source view (AC1 toolbar zoom-in/-out scales source text, AC2 Ctrl+= / Ctrl+- / Ctrl+0 keyboard shortcuts scale + reset, AC3 zoom persists across markdown↔source view switches).

## What went well
- **Bug RCA in one pass.** `bug-expert` localized the defect to `src/styles/source-viewer.css:59-62` (`.source-lines { font-size: 13px }`) overriding the parent inline `font-size: ${zoom*100}%` set at `src/components/viewers/SourceView.tsx:173` — root cause identified before any code was written, so Pattern A (CSS-var bridge + lifted owner) was chosen deterministically.
- **Single-owner refactor landed cleanly.** Removed the duplicate `useZoom('.source')` subscription inside `SourceView.tsx` and made `EnhancedViewer.tsx` the sole owner via `useZoom(getFiletypeKey(path, "source"))`, satisfying AC3 (persists across view switches) without bespoke state-syncing code.
- **Validate + CI green on first push** for commit `8ae23eb` (Step 6 forward-fix attempts = 0).
- **Six of eight expert reviewers approved on first pass** (product, performance, architect, react-tauri, bug, documentation) — the Pattern A fix (CSS var + lifted owner) was idiomatic enough that arch / react-tauri had no objections.
- **Forward-fix completed in a single round.** Both Step 7 BLOCKs (test-expert, lean-expert) were resolved by commit `9c2b95a` and re-review returned 8/8 APPROVE.
- **Regression coverage now spans all three layers** of `docs/test-strategy.md`: unit (`SourceView.test.tsx` zoom describe), component (`EnhancedViewer.test.tsx` toolbar-click forward test), browser e2e (`e2e/browser/zoom-source.spec.ts` asserting computed `font-size` cycle on `.source-view .source-lines`).

## What did not go well
- **Test-expert BLOCK (Step 7 round 1):** initial fix shipped with no browser e2e for source-view zoom — only `e2e/browser/zoom-markdown.spec.ts` existed. Cited as violating rules 3 + 7 in `docs/test-strategy.md` (rendered-effect coverage at the binary boundary). Required a forward-fix commit (`9c2b95a`) to add `e2e/browser/zoom-source.spec.ts` mirroring the markdown variant.
- **Lean-expert BLOCK (Step 7 round 1):** initial fix introduced `src/components/viewers/__tests__/SourceView.zoom.test.tsx` as a separate file with 78 LOC of duplicated mock setup that already existed in the sibling `SourceView.test.tsx`. Same commit also left 19 LOC of dead `.source-plain` / `.source-highlighted` rules in `src/styles/source-viewer.css` (the very file being edited) — a "Never Increase Engineering Debt" violation per `AGENTS.md`. Required folding tests into `SourceView.test.tsx` and deleting the dead CSS in `9c2b95a`.
- **Original test gap was load-bearing.** `EnhancedViewer.test.tsx:10-11` stubbed `<SourceView>` with `<div data-testid="source-view">`, so all pre-existing zoom assertions inspected the root only and never the `.source-lines` computed `font-size`. The 13 px override was structurally invisible to the component layer — exactly the failure mode `docs/test-strategy.md` rule 3 is meant to prevent.
- **Adjacent-risk audit deferred.** `bug-expert` flagged that MarkdownViewer / JsonTreeView / CsvTableView / HtmlPreviewView / KqlPlanView / MermaidView all share the same fragile pattern (parent inline `fontSize` percent + descendant CSS that *could* clobber the cascade). Currently passing only because their hardcoded keys happen to match `getFiletypeKey(_, "visual")`. Not in scope for this iteration; recorded as #92 follow-up Phase 2 candidate.

## Root causes of friction
- **`docs/test-strategy.md` rule 3 (rendered-effect coverage) and rule 7 (browser e2e for visual side-effects) are not enforced by the iterate-one-issue Step 6 checklist.** A bug-mode iteration whose root cause is a CSS cascade override has no path to land *without* a browser e2e — but Step 6 (validate + CI) doesn't fail-closed on missing rendered-effect coverage when changes touch `*.css` plus a viewer component. The test-expert BLOCK in Step 7 was the only gate that caught it.
- **Lean-expert's "edit, don't add" preference is implicit in `AGENTS.md` ("Never Increase Engineering Debt") but not codified in the iterate-one-issue Step 6 checklist** as "if a sibling test file for the same component exists, fold new describes into it." Creating `SourceView.zoom.test.tsx` next to `SourceView.test.tsx` looked locally reasonable (focused file) but globally violated dedupe.
- **The dead CSS (`.source-plain`, `.source-highlighted`) was visible in the diff context** of the iterate fix (same file, same screenful of lines as the `.source-lines` rule being changed) but the implementer didn't sweep it. `AGENTS.md` says "delete dead code in the same PR" — the rule exists, the agent just didn't apply it because no automated check surfaces "you edited this file and left dead siblings."

## Improvement candidates (each must be specifiable)

### Add CSS-cascade-override audit for zoom-aware viewers
- **Category:** bug
- **Problem (with evidence):** `bug-expert` (RCA step 7) flagged that MarkdownViewer / JsonTreeView / CsvTableView / HtmlPreviewView / KqlPlanView / MermaidView all use the same pattern as the original SourceView bug — parent inline `fontSize: ${zoom*100}%` with descendant CSS that *could* declare an absolute `font-size` and silently clobber the cascade. Currently passing only because their hardcoded `useZoom` keys happen to coincide with `getFiletypeKey(_, "visual")`. The defect class that bit `.source-lines` (`src/styles/source-viewer.css:59-62`) is latent in five other viewers.
- **Proposed change:** Add `e2e/browser/zoom-all-viewers.spec.ts` parameterized over `[markdown.md, sample.json, sample.csv, sample.html, sample.kql, sample.mmd]` asserting `getComputedStyle(<viewer leaf>).fontSize` cycles on Ctrl+= / Ctrl+-. Plus a static lint: `scripts/audit-zoom-cascade.mjs` greps `src/styles/*.css` for absolute `font-size:` declarations targeting descendants of `.markdown-view`, `.json-tree`, `.csv-table`, `.html-preview`, `.kql-plan`, `.mermaid-view` and fails if any are not wrapped in `calc(... * var(--<x>-zoom))`.
- **Acceptance signal:** New spec is green for all six viewers; `npm run audit:zoom-cascade` exits 0 on `main`; introducing an absolute `font-size` on any `.source-lines`-equivalent descendant causes the audit to fail in CI.
- **Estimated size:** m
- **Confidence this matters:** high — same defect class flagged in six places by `bug-expert`; the audit closes the class instead of waiting for the next user report.

### Codify "fold into sibling test file" + "sweep dead code in edited files" in iterate-one-issue Step 6
- **Category:** skill
- **Problem (with evidence):** Step 7 lean-expert BLOCK on commit `8ae23eb` cited (a) duplicated 78 LOC of mock setup in a new `SourceView.zoom.test.tsx` instead of folding into existing `SourceView.test.tsx`, and (b) 19 LOC of dead `.source-plain` / `.source-highlighted` rules left in `src/styles/source-viewer.css` — the very file being edited. Both are direct `AGENTS.md` "Never Increase Engineering Debt" violations and both were preventable at implementation time, not review time. The iterate-one-issue skill currently has no Step 6 checklist item for either.
- **Proposed change:** Edit `.claude/skills/iterate-one-issue/SKILL.md` Step 6 to add: (i) "Before creating a new `__tests__/<X>.<feature>.test.tsx`, check if `__tests__/<X>.test.tsx` exists; if yes, add a `describe('<feature>', ...)` block there instead — only split when the parent file exceeds the file-size budget in `docs/architecture.md`." (ii) "For every production file in the diff, run `git diff -U200 <file>` and scan the surrounding ±100 lines for unreferenced selectors / dead exports / TODOs introduced before this iteration; delete any whose only references are within the deleted set."
- **Acceptance signal:** Next bug-mode iteration touching CSS + a sibling-tested component lands in 0 forward-fix rounds (Step 7 lean-expert APPROVE on first pass) where this iteration needed 1.
- **Estimated size:** s
- **Confidence this matters:** medium — the lean BLOCK is reviewer-recoverable in one round, but every avoided forward-fix round saves a full validate+CI cycle and one expert-review batch.

### Make iterate-one-issue Step 6 fail-closed when CSS+viewer changes ship without a browser e2e
- **Category:** test-strategy
- **Problem (with evidence):** Test-expert BLOCK on commit `8ae23eb` cited `docs/test-strategy.md` rules 3 + 7 — a bug-mode fix whose root cause is a CSS cascade override (rendered-effect defect) shipped with only unit + component coverage. Step 6 (validate + CI) passed because CI doesn't know that "diff touches `src/styles/*.css` AND `src/components/viewers/*.tsx`" implies "must have a matching `e2e/browser/zoom-*.spec.ts` or equivalent rendered-effect spec." The gap was caught only at expert-review.
- **Proposed change:** Add `scripts/check-rendered-effect-coverage.mjs` invoked from `.github/workflows/ci.yml` and from iterate-one-issue Step 6: if the PR diff touches both `src/styles/**/*.css` and `src/components/viewers/**/*.tsx`, require at least one changed/added file under `e2e/browser/**/*.spec.ts` in the same diff. Fails closed otherwise with a message pointing at `docs/test-strategy.md` rules 3 + 7.
- **Acceptance signal:** Re-running the iter-1 implementer against a synthetic version of `8ae23eb` (CSS+viewer diff, no browser e2e) causes Step 6 to fail with the rendered-effect message before reaching expert review.
- **Estimated size:** s
- **Confidence this matters:** high — directly closes the test-expert BLOCK class for all future zoom / theme / font / layout CSS changes, not just this one.

## Carry-over to the next run
- #92 follow-up Phase 2 candidate (per `bug-expert`): audit MarkdownViewer / JsonTreeView / CsvTableView / HtmlPreviewView / KqlPlanView / MermaidView for the same cascade-override pattern that bit `.source-lines`. Captured above as the first improvement candidate.
- Goal-assessor pre-iter confidence was 98% in_progress with 6/6 R unmet; reassess pending after iter-1 (expected 6/6 met → Done-Achieved at next assessor run).

## BUG_RCA

**1. Reproduction** — Open any non-markdown text file (e.g., x.ts). Press Ctrl+= or click toolbar Zoom-in. Observed: text size unchanged. Expected: text size scales.

**2. Root cause** — `src/styles/source-viewer.css:59-62` declared `.source-lines { font-size: 13px }`, an explicit child rule overriding the cascaded `font-size: ${zoom*100}%` set inline at `src/components/viewers/SourceView.tsx:173` on the parent `.source-view`. The `13px` override won the cascade because it was a child-element direct rule vs. an inherited percent.

**3. Introduction** — Commit 36600e2 (PR #3 "enhanced file viewer"). Pre-dates per-filetype zoom (#65 D1/D2/D3); never relaxed when zoom landed.

**4. Test gap** — Existing EnhancedViewer.test.tsx:10-11 stubbed SourceView with `<div data-testid="source-view">`, so zoom assertions only inspected the root, never the .source-lines computed font-size. The 13px override was invisible to component tests. No browser e2e existed for source-view zoom (only `e2e/browser/zoom-markdown.spec.ts` covered the markdown case). Violates docs/test-strategy.md rules 3 + 7.

**5. Regression-test plan** — Add `e2e/browser/zoom-source.spec.ts` mirroring `zoom-markdown.spec.ts`: open .md → switch to Source via toolbar → assert `getComputedStyle('.source-view .source-lines').fontSize` cycles on Ctrl+= ×2 (>1.15× baseline), Ctrl+- shrinks, Ctrl+0 resets. Plus toolbar-click variant.

**6. Fix direction (Pattern A)** — (a) Add `--source-zoom: 1` default to `.source-view` CSS rule. (b) Change `.source-lines { font-size: 13px }` → `font-size: calc(13px * var(--source-zoom))`. (c) `SourceView` accepts `zoom: number` as required prop; sets inline `style={{ "--source-zoom": zoom } as React.CSSProperties}` on `.source-view` root. (d) Remove `useZoom('.source')` call from SourceView (was a duplicate subscription using a stale literal key). (e) `EnhancedViewer` (already the single owner via `useZoom(getFiletypeKey(path, "source"))`) passes `zoom={zoom}` down. Single owner per filetypeKey; CSS-var bridge ends the cascade-override defect class for `.source-lines`.

**7. Adjacent risk** — MarkdownViewer / JsonTreeView / CsvTableView / HtmlPreviewView / KqlPlanView / MermaidView all use `useZoom` and apply inline `fontSize` percent on their respective roots. Bug-expert verified those don't currently misalign (their hard-coded keys happen to match `getFiletypeKey(_, "visual")`), but the pattern is fragile. Worth a follow-up audit checking each for hardcoded `font-size` declarations on descendants of the zoom-styled root that could clobber the cascade (#92 follow-up Phase 2 candidate).
