# Retrospective — iteration 1/30 (PASSED)

## Goal of this iteration
Satisfy all acceptance criteria of #65: viewer overhaul follow-up — 6 remaining audit items (E1 mtime row, G1 code-block hover-copy, G2 print stylesheet + dual-theme Shiki, G3 Find-in-Page via CSS Custom Highlight API, H1 HTML allow-images via fetch_remote_asset, H2 scripts-mode link routing bridge).

## What went well
- 5-way parallel implementer dispatch (groups A–E) landed in a single base commit `53ee4ac` with 38 files touched and no merge conflicts — group decomposition by feature (mtime / copy button / print / find / html) had zero shared-state collisions.
- Round-2 expert review converged in one fix commit `b644a33` addressing all 3 BLOCKs (architect B1, performance B2, documentation B3+B4) — no third round needed.
- Goal assessor returned 95% confidence, 6/6 ACs met, on first post-fix evaluation.
- e2e caught a Chromium-specific sandbox-reevaluation bug (`1a30177`) that no unit/component test could have surfaced — pyramid worked as designed.
- Performance reviewer caught all 3 sub-issues in `html-image-rewrite.ts` (unbounded Promise.all, O(N·H) replace, dual-effect split for HtmlPreviewView) before merge.

## What did not go well
- **Implementer group E shipped unbounded fetches in new code.** `src/lib/html-image-rewrite.ts` (commit `53ee4ac`) used `Promise.all(matches.map(fetchRemoteAsset))` with no cap and an O(N·H) `String.replace` loop. Caught by `performance-expert` at review (B2), violates rule 1 in `docs/performance.md` ("cap every unbounded input"). Required a separate fix commit.
- **Implementer groups A and D skipped `docs/features/viewer.md` updates** for user-visible capabilities (mtime row in status bar, Find-in-Page bar). Only group C (Print) updated docs in the base commit. Caught by `documentation-expert` at review (B3), violates the `documentation-expert` taxonomy/freshness rule (`.claude/agents/documentation-expert/agent.md`).
- **Lint forward-fix loop on `src/hooks/useFindInPage.ts`** burned ~3 implementer attempts before landing on the correct shape. `react-hooks/set-state-in-effect` (eslint-plugin-react-hooks 7.x) fires non-deterministically on the first offending line in an effect; updater-form rewrite passed lint but read awkwardly, blanket `eslint-disable` produced `--report-unused-disable-directives` warnings, only a single targeted disable on the jsdom-degraded `setMatches(0)` site worked.
- **Chromium iframe sandbox quirk discovered post-merge in Step 6** (commit `1a30177`): `iframe.setAttribute('sandbox', 'allow-scripts')` on an existing iframe does not re-evaluate sandbox; document keeps its initial sandbox bits. Required `key={sandbox}` remount. Not documented anywhere in `docs/architecture.md` or `docs/design-patterns.md`, will reoccur for any future iframe sandbox toggle.
- **`B1` console.info regression in new code.** `src/hooks/useFindInPage.ts` shipped a raw `console.info` call. Violates rule 6 in `docs/architecture.md` (logger chokepoint). The implementer for group D did not pre-consult the architecture rules.

## Root causes of friction
1. **Implementer pre-consult is incomplete.** Implementers for groups D (logger) and E (perf budgets) clearly did not read `docs/architecture.md` rule 6 and `docs/performance.md` rule 1 before writing code. The `exe-task-implementer` agent prompt does not enforce a "must-cite rules from docs/X.md before writing" pre-step. Result: known-canonical rules get rediscovered at review time, costing one round-trip per category.
2. **No iframe sandbox guidance exists.** `docs/design-patterns.md` covers React 19 + Tauri v2 idioms but has no entry for Chromium's "sandbox attribute is sticky after creation" behavior. Only e2e surfaced it; no unit test could.
3. **`docs/features/*.md` updates are not gated.** Nothing in `AGENTS.md` or implementer prompt says "if you add user-visible behavior, the matching `docs/features/<area>.md` MUST change in the same diff." Documentation drift is only caught by the review pass.
4. **`react-hooks/set-state-in-effect` is non-deterministic** in eslint-plugin-react-hooks 7.x — cites different lines on re-runs. No project-side fix; surface as a known-trap memory.

## Improvement candidates (each must be specifiable)

### Add iframe sandbox-reevaluation rule to design-patterns.md
- **Category:** docs
- **Problem (with evidence):** Commit `1a30177` documents that `iframe.sandbox = 'allow-scripts'` set on an existing element does not re-evaluate; Chromium reads sandbox only on iframe creation. Caught only by e2e (`enableScripts` toggle test) — `srcdoc` still ran under the original `allow-same-origin` sandbox even though `iframe.sandbox` reported `allow-scripts`. Fix required `key={sandbox}` to force unmount/remount. No rule in `docs/design-patterns.md` or `docs/architecture.md` warns of this; future iframe work will hit it again.
- **Proposed change:** Add numbered rule to `docs/design-patterns.md` (Tauri/web idioms section): "Iframe sandbox is evaluated only at element creation. Any code path that toggles `sandbox` flags MUST force a remount via React `key={sandboxValue}` (or equivalent imperative remove/recreate). Mutating `iframe.sandbox` on a live element is a silent no-op." Link the rule from `HtmlPreviewView.tsx` source comment near the `key={sandbox}` line.
- **Acceptance signal:** New rule numbered in `docs/design-patterns.md`; `HtmlPreviewView.tsx` has a `// see docs/design-patterns.md rule N` comment on the `key={sandbox}` prop; `react-tauri-expert` agent can cite the rule by number on future iframe diffs.
- **Estimated size:** xs
- **Confidence this matters:** high — this is a real Chromium contract that cost an entire forward-fix round, and any future sandbox-toggle (e.g., add `allow-forms`) will rediscover it.

### Require implementer pre-consult of canonical rules in exe-task-implementer prompt
- **Category:** agent
- **Problem (with evidence):** Group E implementer wrote `src/lib/html-image-rewrite.ts` with `Promise.all(matches.map(...))` (unbounded) and O(N·H) `String.replace` — both direct violations of `docs/performance.md` rule 1 ("cap every unbounded input"). Group D shipped raw `console.info` in `src/hooks/useFindInPage.ts` violating `docs/architecture.md` rule 6 (logger chokepoint). Both caught at review (B1, B2 in `b644a33`), requiring a fix commit. Pattern repeats across iterations: implementers don't pre-load rule lists for the layer they're touching.
- **Proposed change:** Edit `.claude/agents/exe-task-implementer/agent.md` (or equivalent in `src-tauri/src/.../agents/` if that's where it lives). Add a "Pre-flight" step before any code write: "For every file you create or edit, list which `docs/*.md` rules apply (architecture for IPC/logging/layering, performance for any loop/fetch/effect, security for any FS or IPC handler) and quote the rule numbers in your scratchpad. Failing to do this is a process violation independent of whether the resulting code is correct." Have Phase 2 verify the agent prompt change in a follow-up issue.
- **Acceptance signal:** On the next iteration, implementer scratchpads/PR descriptions cite specific rule numbers from `docs/architecture.md` / `docs/performance.md` for each touched file. Round-1 expert review BLOCK count for "missed-canonical-rule" violations drops to ≤1 across implementer groups.
- **Estimated size:** s
- **Confidence this matters:** high — this is the third+ iteration where perf and logger rules are rediscovered at review; the cost is one extra commit per iteration plus reviewer cycles.

### Make docs/features/<area>.md updates a hard implementer output for user-visible changes
- **Category:** process
- **Problem (with evidence):** In `53ee4ac`, groups A (mtime row in status bar) and D (Find-in-Page bar) added user-visible UI without touching `docs/features/viewer.md` or `docs/features/app-chrome.md`. Only group C updated docs. `documentation-expert` flagged the gap (B3) and required a fix in `b644a33`. `AGENTS.md` lists `docs/features/` as the canonical evergreen description but doesn't make updates mandatory per change.
- **Proposed change:** Edit `AGENTS.md` "Feature Documentation" section: add explicit rule "Any PR that adds, removes, or changes user-visible behavior MUST update the matching `docs/features/<area>.md` in the same diff. Reviewer agents will BLOCK on missing feature-doc deltas." Mirror in `.claude/agents/exe-task-implementer/agent.md` pre-flight checklist as a yes/no gate. Add a check to `documentation-expert` agent prompt to scan diff for user-visible-behavior heuristics (new component prop, new toolbar item, new keybinding, new status bar row, new menu entry) and require matching `docs/features/*.md` hunk.
- **Acceptance signal:** On the next iteration with user-visible changes, every implementer group that touches a user-visible area produces a `docs/features/*.md` hunk in the same commit; `documentation-expert` round-1 review reports zero feature-doc-gap BLOCKs.
- **Estimated size:** s
- **Confidence this matters:** high — pattern recurs across iterations and is the single most common documentation-expert BLOCK category.

### Memory: react-hooks/set-state-in-effect rule is non-deterministic in v7.x
- **Category:** skill
- **Problem (with evidence):** During iter-1 lint loop on `src/hooks/useFindInPage.ts`, three implementer attempts were burned: (1) updater-form rewrite passed lint but read awkwardly, (2) blanket `/* eslint-disable react-hooks/set-state-in-effect */` produced `--report-unused-disable-directives` warnings on lines the rule did not flag, (3) single targeted disable on the jsdom-degraded `setMatches(0)` site worked. Underlying behavior: the rule cites only the first offending line in an effect, and "first" is non-deterministic across runs/refactors.
- **Proposed change:** `store_memory` (subject "linting") with fact: "eslint-plugin-react-hooks 7.x `react-hooks/set-state-in-effect` reports only the first offending call in an effect, non-deterministically across runs. When silencing, use a single targeted `// eslint-disable-next-line react-hooks/set-state-in-effect` on one specific line — never blanket-disable, which produces `--report-unused-disable-directives` warnings." Cite `src/hooks/useFindInPage.ts` and commit `53ee4ac`.
- **Acceptance signal:** Memory stored and retrievable; future implementers facing the same lint error apply the targeted-disable shape on first attempt.
- **Estimated size:** xs
- **Confidence this matters:** medium — useful when it recurs but the rule may be fixed upstream; cheap to store either way.

### Add image-rewrite / fetch-fanout pattern to docs/best-practices-project/hot-paths
- **Category:** docs
- **Problem (with evidence):** `src/lib/html-image-rewrite.ts` shipped without a cap (matches > 100), without a worker-pool (`FETCH_CONCURRENCY=8`), and with O(N·H) string rebuilding. All three were added in `b644a33` after `performance-expert` BLOCK. The pattern "scan user-supplied document for N references and fetch each" will recur (e.g., `<link>` resources, `<video>` posters, future inline-asset features) and there is no canonical recipe in `docs/best-practices-project/`.
- **Proposed change:** Add `docs/best-practices-project/fetch-fanout.md` (or extend the existing hot-paths file) with the canonical recipe used in `html-image-rewrite.ts`: cap matches at a documented constant, run a fixed-size worker pool (default 8), rebuild output via single-pass slice concat not iterative `String.replace`. Reference the file from `docs/performance.md` rule 1.
- **Acceptance signal:** New canonical doc exists; `performance-expert` can cite it by path on future fetch-fanout diffs instead of re-deriving the three sub-rules each time.
- **Estimated size:** s
- **Confidence this matters:** medium — pattern will recur (multiple HTML asset types pending) but only when those features are actually added.

## Carry-over to next iteration
- Decide whether `docs/design-patterns.md` iframe-sandbox rule lands as a follow-up issue or is folded into the next viewer-area iteration.
- Verify `b644a33` performance fixes (`FETCH_CONCURRENCY=8`, cap=100, single-pass slice rebuild) in actual e2e perf timings — current verification was code-review only, no measured numbers in CI.
- The `exe-task-implementer` pre-flight rule-citation change should land before the next multi-group parallel iteration to maximize cost-savings.
