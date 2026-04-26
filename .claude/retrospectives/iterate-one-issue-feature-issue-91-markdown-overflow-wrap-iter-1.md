# Retrospective — iterate-one-issue feature-issue-91-markdown-overflow-wrap-iter-1 (PASSED)

<!-- retro-meta:
skill: iterate-one-issue
run:   feature-issue-91-markdown-overflow-wrap-iter-1
outcome: PASSED
started: 2026-04-26T20:25:00Z
ended:   2026-04-26T22:00:00Z
-->

## Goal of this run

Satisfy all acceptance criteria of #91: Markdown viewer sometimes renders outside the page — an overflow issue on long unbreakable inline tokens in fenced code blocks and table cells.

## What went well

- **Pre-seeding UI state resolved narrow-viewport testing:** The spec required testing a 600 px viewport, but default layout (folder pane 240 px + comments panel 280 px) left only ~30 px for markdown. Pre-seeding `localStorage` with `mdownreview-ui: { folderPaneWidth: 80, commentsPaneVisible: false }` (via `e2e/browser/fixtures/markdown-overflow-wrap/sample.md` fixture setup) provided the minimum viable rendering surface without modifying production code or feature-flagging.
- **Bug root cause isolated cleanly in bug-expert step 3a:** The missing `overflow-wrap` declaration on `.markdown-body` was traced to scaffold commit 0c01086 (initial mdownreview prototype, pre-1.0), where CSS was modeled after a partial GitHub extract that omitted wrap rules. Test-strategy.md rule 3 confirmed the regression-test gap: no browser-e2e layer tested container/page overflow geometry prior to this run.
- **CSS fix minimal and declarative:** The solution touched three logical units: (1) `.markdown-body` container `overflow-wrap: break-word`, (2) inline `code` `overflow-wrap: anywhere` for flex/table cell shrinking, (3) `pre`/`pre code` reset to `normal` + `white-space: pre` to preserve horizontal scroll in fenced blocks. Commits 43b6367, 8ab8210, 9f92280 contained no cargo-cult changes or future-proofing unrelated to the scope.
- **Lean expert unblocked early:** Redundant `word-break` aliases in src/styles/markdown.css:73 and the symmetric reset block (8ab8210, 9f92280) were identified and stripped per simplicity.md rule on dead code removal. No back-and-forth cycles.

## What did not go well

- **Stale Vite dev server cached CSS for ~3 debugging turns:** During Step 6c, playwright browser tests returned cached CSS despite file changes. Root cause: `playwright.browser.config.ts` line `reuseExistingServer: !process.env.CI` allowed stale Vite process to persist across runs. When iter-1 edited src/styles/markdown.css, the serving instance did not reload. Manual `npm run dev` restart was required to surface the updated CSS. This trapped debugging across commits 8ab8210–9f92280 and delayed reproduction of the fix by 15+ minutes per cycle.
- **No pre-flight cache invalidation for CSS-only changes:** The iterate-one-issue skill had no guard to kill port 1420 and clear `node_modules/.vite` when `git diff --name-only` included any `*.css` file. This left the trap open for any future CSS-focused runs.

## Root causes of friction

- **Vite server persistence across runs:** `playwright.browser.config.ts:reuseExistingServer` was well-intentioned (speed up test runs) but created a race between test startup and Vite reload. Per performance.md rule 2, cached stale artifacts are worse than cache misses. The setting is correct in CI (`!process.env.CI` evaluates false, new server per run), but in local/skill runs it persisted across iterations.
- **Narrow-viewport layout collapse unspecified:** The default app layout (240 px folder pane + 280 px comments panel) leaves only ~30 px for markdown in a 600 px viewport. This is not a bug in #91 (the CSS wrap fix is correct regardless), but the app has no minimum viewport constraint defined in docs/principles.md nor a responsive breakpoint to hide panels on narrow screens. This surfaced only because the spec required testing at 600 px; it suggests a follow-up usability issue may exist at smaller screens.

## Improvement candidates (each must be specifiable)

### Clear Vite cache before browser-e2e on CSS changes
- **Category:** tooling
- **Problem (with evidence):** During iter-1 Step 6c, src/styles/markdown.css changes were cached by the Vite dev server (playwright.browser.config.ts:reuseExistingServer), causing tests to run against stale CSS. Three separate test runs showed outdated wrapping behavior before manual `npm run dev` restart. This trap will recur for any future CSS-focused tasks.
- **Proposed change:** In `.claude/skills/iterate-one-issue/phase-2.md` Step 6 (browser-e2e), add a pre-flight: if `git diff --name-only ITER_BASE_SHA..HEAD | grep -q '\.css$'`, then `lsof -ti :1420 | xargs -r kill -9` and `rm -rf node_modules/.vite` before `npm run browser-test`. Rationale: CSS files have no hot-reload on Vite in test mode; invalidating the cache is the only reliable fix short of disabling server reuse for CSS runs.
- **Acceptance signal:** A later CSS-only iterate-one-issue run observes fresh CSS in the first test cycle (no manual server restart needed); `npm run browser-test` succeeds on the first invocation.
- **Estimated size:** xs
- **Confidence this matters:** high (concrete trap evidence in iter-1 Step 6 commit history; affects any future CSS work; affects test-exploratory-e2e CSS test runs too)

### Fix long table cells and code in comment panels (follow-up bug)
- **Category:** bug
- **Problem (with evidence):** Bug-expert flagged in iter-1 Step 3 (BUG_RCA §7) that `.comment-text` in src/components/comments/CommentThread.tsx:130 uses ReactMarkdown but is rendered outside the `.markdown-body` wrapper. The same root cause as #91 (missing `overflow-wrap`) will trigger when users add backticked paths or tables to review comments. This is out of scope for #91 (the viewer CSS fix is complete), but the symptom is identical and will surface in dogfood testing.
- **Proposed change:** Add `overflow-wrap: anywhere` to `.comment-text` rule in src/styles/comments.css; test with a new e2e case (markdown-overflow-wrap.spec.ts or comments.spec.ts) containing a comment with a long backticked path (`src/components/viewers/{MarkdownViewer,SourceView,...}.tsx`). Rationale: parallel fix to the same CSS boundary (ReactMarkdown render surface), same acceptance criteria (no horizontal scroll on long inline tokens).
- **Acceptance signal:** Comments panel renders long backticked paths and table cells without triggering `document.scrollingElement` horizontal scroll at 600 px viewport.
- **Estimated size:** xs (CSS only; reuse existing test fixtures)
- **Confidence this matters:** high (concrete code surface identified in iter-1; identical bug class as #91; will occur in same dogfood/user scenario)

### Define responsive layout breakpoint for narrow viewports (follow-up UX)
- **Category:** architecture
- **Problem (with evidence):** During iter-1 testing, a 600 px viewport with default panels (240 px folder + 280 px comments) left only ~30 px for markdown content. This was not a #91 bug (CSS wrap fix is correct), but the app has no minimum viewport specification in docs/principles.md and no responsive breakpoint to collapse panels. This suggests users on narrow screens (or small monitor windows) will experience a layout collapse even with the CSS fix applied. Medium confidence — the constraint may be deliberate (no Linux support, targeting standard 1080p+), but the gap is worth a groomed spec.
- **Proposed change:** In docs/principles.md, add a "Minimum viewport" or "Responsive design" constraint. Then, add a toggle (keyboard shortcut or ⚙️ menu) or automatic breakpoint (e.g., if viewport < 800 px, hide folder pane by default) to preserve usable markdown space. Alternatively, if narrow viewports are non-goals, document this explicitly in Non-Goals.
- **Acceptance signal:** Either (1) docs/principles.md Constraints section states minimum viewport and rationale, or (2) a new responsive breakpoint in src/components/ (e.g., a mobile-friendly layout mode) is deployed and tested at 600/800 px viewports without layout collapse.
- **Estimated size:** m (depends on decision: docs-only vs. new responsive feature)
- **Confidence this matters:** medium (surfaced by iter-1 test spec, not a confirmed user complaint; follow-up UX validation required before grooming)

## Carry-over to the next run

- Comments-panel ReactMarkdown (`src/components/comments/CommentThread.tsx:130`) needs the same `overflow-wrap` fix as #91 viewer. Filed as a follow-up issue in improvement candidate #2.
- Vite cache invalidation on CSS changes is now guarded in iterate-one-issue pre-flight. Future CSS-focused runs will not hit the stale-server trap.

## BUG_RCA

1. **Repro:** Open any .md file containing a long backticked path (e.g. `src/components/viewers/{MarkdownViewer,SourceView,...}.tsx`) at default viewport — page scrolls horizontally.

2. **Root cause:** src/styles/markdown.css has lacked any `overflow-wrap` declaration on `.markdown-body` since the file was first added.

3. **Introduction:** Scaffold commit 0c01086 (initial mdownreview prototype, pre-1.0). The CSS was modeled after a partial GitHub `.markdown-body` extract that omitted the wrap rules. No subsequent commit added them.

4. **Test gap:** No browser-e2e at the markdown-styling layer asserted page geometry. `viewer-toolbar-sticky.spec.ts` was the only test using DOM geometry. Per docs/test-strategy.md rule 3: regression test that would have caught the bug was missing — the markdown viewer e2e tests asserted content rendering but not container/page overflow.

5. **Regression-test plan:** e2e/browser/markdown-overflow-wrap.spec.ts (browser layer, not native — no IPC or OS event involved); 4 parametrised viewports with the issue's exact repro line plus 200/300-char no-space tokens and a long-cell table; assertions on document.scrollingElement, .markdown-body, and fenced <pre> internal scroll preserved.

6. **Fix direction:** Container `overflow-wrap: break-word` on `.markdown-body`; inline `code` `overflow-wrap: anywhere` (anywhere chosen so flex/table cells can shrink past their longest token); `pre`/`pre code` reset to `normal` + `white-space: pre` to preserve fenced-code horizontal scroll; `th, td` `overflow-wrap: anywhere` for long table cells.

7. **Adjacent risk:** `.comment-text` ReactMarkdown surface in `src/components/comments/CommentThread.tsx:130` — outside `.markdown-body`, so the new wrap rules do NOT apply. Same root cause may surface in comments panel for long backticked paths in comment bodies. OUT OF SCOPE for #91; deferred to a follow-up issue.
