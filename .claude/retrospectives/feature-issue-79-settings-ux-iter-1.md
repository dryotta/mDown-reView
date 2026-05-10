# Retrospective — iteration 1/30 (PASSED)

## Goal of this iteration
Satisfy all 13 acceptance criteria of #79 by replacing the welcome-screen / first-run setup modals with a unified Settings region (Groups A — Settings shell + routing, B — author/onboarding/CLI/file-association/folder-context rows, C — copy/help affordances and dead-Welcome cleanup).

## What went well
- Groups A+B+C landed as a single coherent commit (`c26210b feat(#79): iter 1 — replace welcome/setup modals with Settings region`) with all three groups passing local validation green on first run — tsc, lint, vitest, cargo, and the full e2e suite.
- Step 6 (impl-driven validation loop) needed **0 forward-fix attempts** — implementer agent `impl-79-b101112` produced compileable, lint-clean, test-green code on first dispatch.
- The full 9-expert panel ran in Step 7 with 5 of 9 reviewers (lean, performance, react-tauri, security, documentation) returning APPROVED on first pass.
- The single forward-fix commit (`77bbf0a fix(iter-1): forward-fix expert-review blockers`) cleanly resolved every round-1 BLOCK; the focused round-2 panel (product, architect, test, bug) returned APPROVED with no new findings.
- Assessor confidence trajectory: prev 0% → curr ~95–100% (full coverage of the 13 ACs).

## What did not go well
- **bug-expert (round 1) — CRITICAL:** Toolbar/menu "Settings" entry-point opened both `<SettingsDialog>` and `<SettingsView>` simultaneously because both surfaces subscribed to the same `settingsOpen` flag (`App.tsx:236` view mount + `App.tsx:257` dialog mount). `HTMLDialogElement.showModal()` placed the dialog in the top layer and inerted the underlying view, producing a dead non-interactive Settings region behind a modal — exact symptom predicted by product-expert independently.
- **product-expert (round 1):** Settings was unreachable when any tab was open because the routing in `App.tsx` rendered the active viewer instead of the Settings region (`App.tsx` routing branch, pre-77bbf0a). Compounded by the co-mount above (`App.tsx:259` inert SettingsView), per-row copy too sparse, and "done"/"unsupported" rows rendering inert switches with no affordance distinguishing them from actionable rows.
- **architect-expert (round 1):** Principle 3 (Architecturally Sound) violation — single `settingsOpen` boolean drove two mount surfaces (`App.tsx:236` + `App.tsx:257`), violating `docs/architecture.md` rule 16 (single chokepoint per concern). Also flagged drift in `docs/architecture.md` rule 3 (onboarding-state schema count documented as ×3, actually ×1 after consolidation).
- **test-expert (round 1):** `src/store/uiSlice` missing unit tests for the new `refreshOnboarding` action and 5 setup-action wrappers; `SettingsView` missing branch coverage for `unsupported` and `noop` row states; e2e suite contained `HTMLDialogElement.prototype.showModal = HTMLDialogElement.prototype.show` monkey-patch — a dishonest workaround that masked the very co-mount bug bug-expert flagged (violates `docs/test-strategy.md` rule 3); missing mount-side-effect test asserting Settings does not auto-open on app boot.
- **bug-expert (round 1) — HIGH:** Dead `Help → Welcome` menu entry survived B7 cleanup; menu emitted an event with no listener, silently no-op for the user.
- **bug-expert (round 1) — SUSPECTED:** Per-row pending state in setup-action wrappers had a double-click race window (rapid double-click could fire two IPC calls before pending flipped). Not confirmed; not fixed in 77bbf0a.

## Root causes of friction
1. **Single-flag-drives-two-surfaces is a recurring class.** The `settingsOpen` boolean was overloaded to mean both "show the inline Settings region" and "open the modal Settings dialog." This is the same shape as past welcome/onboarding bugs and is not currently lint-able. `docs/architecture.md` rule 16 (chokepoint) covers IPC and logger but does not explicitly forbid mount-time multi-surface boolean overloading.
2. **Dishonest test workarounds erode the test pyramid.** Monkey-patching `HTMLDialogElement.prototype.showModal` to alias `.show()` made the e2e green while hiding the production top-layer/inert behaviour that *was* the bug. `docs/test-strategy.md` rule 3 (no test workarounds for product bugs) exists in spirit but has no enforced detection.
3. **Doc drift on schema-versioned state.** `docs/architecture.md` rule 3 was not updated when onboarding state collapsed from three records to one — a pattern previous retros have flagged (docs-as-spec slips during refactors).
4. **Expert-review re-run cost.** Step 7 of the iterate skill says "re-run the SAME panel" after forward-fix, but only the 4 BLOCKers needed verification — the 5 already-APPROVED experts re-ran for no signal, lengthening iteration wall-clock.
5. **Action-wrapper dedup is per-component.** Each setup-row wrapper reimplements its own pending guard ref. There is no slice-level or hook-level dedup primitive.

## Improvement candidates (each must be specifiable)

### Forbid single-boolean multi-surface mounts via architecture rule + lint
- **Category:** architecture
- **Problem (with evidence):** `App.tsx:236` mounted `<SettingsView>` and `App.tsx:257` mounted `<SettingsDialog>` from the same `settingsOpen` flag, producing the CRITICAL co-mount bug bug-expert reported in round 1. architect-expert cited this as a `docs/architecture.md` rule 16 violation, but rule 16 today reads as IPC/logger chokepoint guidance only and does not name "boolean→two mounts" as a forbidden shape. The same mistake has surfaced previously around onboarding/welcome state.
- **Proposed change:** Add a new numbered rule to `docs/architecture.md` (e.g. rule 17): "A single store boolean MUST NOT gate the mounting of two distinct UI surfaces. If two surfaces represent two presentations of the same intent, model the intent as a discriminated-union state (e.g. `settingsSurface: 'closed' | 'inline' | 'modal'`) so only one surface is renderable at any time." Add an ESLint rule (custom or `no-restricted-syntax`) that flags JSX where `{flag && <X/>}` and `{flag && <Y/>}` reference the same identifier within the same parent. Migrate `settingsOpen` to a discriminated union as the reference fix.
- **Acceptance signal:** New `docs/architecture.md` rule cited by number; ESLint rule lands with at least one positive test (current `App.tsx` shape pre-fix should fail) and one negative test (post-fix discriminated union should pass); `settingsSurface` union committed.
- **Estimated size:** m
- **Confidence this matters:** high — exact bug recurred this iteration and architect-expert flagged it explicitly as a class, not an instance.

### Ban dishonest browser-API monkey-patches in e2e
- **Category:** test-strategy
- **Problem (with evidence):** The round-1 e2e suite contained `HTMLDialogElement.prototype.showModal = HTMLDialogElement.prototype.show` to make tests pass against the broken co-mount. test-expert flagged this as a `docs/test-strategy.md` rule 3 violation: the patch hid the exact top-layer/inert behaviour that constituted the production bug. Without bug-expert's independent finding, this patch would have shipped.
- **Proposed change:** Add explicit prohibition to `docs/test-strategy.md` rule 3 (or new sub-rule 3a): "Tests MUST NOT mutate `*.prototype.*` of browser/DOM APIs to make assertions pass. If a real-DOM behaviour (top-layer, inert, focus trap) breaks the test, fix the product, not the API." Add a custom ESLint rule under `e2e/` (and `src/**/*.test.{ts,tsx}`) that bans `Identifier.prototype.Identifier =` assignment via `no-restricted-syntax`. Reference list of forbidden patches: `HTMLDialogElement.prototype.showModal`, `HTMLDialogElement.prototype.close`, `Element.prototype.scrollIntoView`, `window.matchMedia` (use existing fixture instead).
- **Acceptance signal:** ESLint rule lands; running it against the pre-77bbf0a tree reproduces the violation; `docs/test-strategy.md` rule 3 cites the new sub-rule.
- **Estimated size:** s
- **Confidence this matters:** high — caught a CRITICAL bug from shipping; cheap to enforce.

### Extract a `useInFlightGuard()` hook (or slice-level dedup) for action wrappers
- **Category:** architecture
- **Problem (with evidence):** bug-expert SUSPECTED a double-click race in per-row setup-action wrappers — each wrapper hand-rolls a `pendingRef` / `useState('idle'|'pending'|'done')` to dedup rapid clicks, and the per-row implementations are easy to subtly desync (the 5 wrappers in `uiSlice` each gained their own copy via `c26210b`). Not confirmed as a reproducible bug, but the shape is identical across the 5 wrappers and across earlier comment-action wrappers.
- **Proposed change:** Add `src/hooks/useInFlightGuard.ts` returning `{ run: (fn: () => Promise<T>) => Promise<T | undefined>, pending: boolean }` that no-ops re-entry while a call is in flight. Migrate the 5 setup-action wrappers in `uiSlice` (or the components that consume them) to call `run(action)` instead of hand-rolling pending refs. Add a vitest unit test that fires `run()` 50 times in the same tick and asserts `fn` was called exactly once.
- **Acceptance signal:** New hook + unit test landed; the 5 wrappers (and any further setup-row added) use it; bug-expert's SUSPECTED finding closed by either the hook or a regression test demonstrating the race no longer fires.
- **Estimated size:** s
- **Confidence this matters:** medium — bug-expert finding was SUSPECTED, not confirmed, but the duplication is real and the hook is tiny.

### Codify "focused re-review of BLOCKers only" in the iterate skill Step 7
- **Category:** skill
- **Problem (with evidence):** This iteration ran the full 9-expert panel in round 1 (5 APPROVED, 4 BLOCKed) and then per the current iterate skill text would have re-run all 9 in round 2 — but only the 4 BLOCKers had anything to verify. The current skill text says "re-run the SAME panel"; in practice we ran a focused 4-expert panel and it was both faster and equally rigorous (round 2 returned APPROVED with no false positives from already-cleared experts).
- **Proposed change:** Edit the iterate skill (`.claude/skills/iterate/` Step 7) to say: "On forward-fix re-review, re-run ONLY the experts that returned BLOCK or REQUEST_CHANGES in the prior round. Experts that returned APPROVED are considered green for this iteration unless the forward-fix touched files outside their previously-reviewed scope (in which case re-add them)." Include a one-line worked example matching this iteration (9 → 4).
- **Acceptance signal:** Skill text updated; next iteration's review log shows the focused-panel pattern explicitly cited.
- **Estimated size:** xs
- **Confidence this matters:** medium — saves wall-clock and reviewer-token spend on every multi-blocker iteration; no downside if the "scope check" clause is honoured.

### Sweep `docs/architecture.md` rule 3 (and similar count-based rules) for drift
- **Category:** docs
- **Problem (with evidence):** architect-expert round 1 caught `docs/architecture.md` rule 3 still claiming three onboarding-state schema-versioned records when the codebase had collapsed to one. This is the same class of drift as previous retros (`feature-issue-71-comment-ux-followup-iter-1.md` flagged similar slip).
- **Proposed change:** Add a `documentation-expert` checklist line to its agent spec (`.claude/agents/documentation-expert/agent.md`) explicitly: "When a refactor changes the count or list-shape of an enumerated thing (schema-versioned states, viewer types, slices, IPC commands), grep `docs/**/*.md` for the prior count word/number and update every occurrence in the same PR." Verify by running the grep on the current tree and producing zero hits for stale counts.
- **Acceptance signal:** Agent spec updated; one-shot sweep of docs/ yields no stale enumerations against the current tree.
- **Estimated size:** xs
- **Confidence this matters:** medium — recurring low-grade noise that erodes docs-as-spec credibility.

## Carry-over to next iteration
- bug-expert SUSPECTED double-click race in per-row pending state remains unconfirmed and unfixed in `77bbf0a`; iteration 2 should either reproduce-and-fix or close it explicitly with a unit test (see `useInFlightGuard()` candidate above).
- Assessor re-check still pending — iteration 2 starts with a re-assessment of the 13 ACs against the post-`77bbf0a` tree before any new work is scoped.
