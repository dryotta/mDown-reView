# Retrospective — issue #352 / PR #353 Excalidraw integration: the data-loss bug class

**Date:** 2026-05-03
**Scope:** PR #353 — `feature/issue-352-excalidraw-integration` — iter-1 through iter-21 (commits `2f7d2ae` … `4c3e305`).
**Audience:** future contributors and reviewers of any feature that writes user files.
**Status:** all P0 ship-blockers fixed (commits `4c4c2e7`, `22ef23f`, `4c3e305`); CI green; this retro is the lessons-learned dossier.

> **Thesis.** Across ~22 iterations we shipped (and then patched) **at least 17 distinct silent-data-loss or near-miss bugs**, all in a single bounded carve-out feature (`viewer-not-editor` exception for `.excalidraw[lib]` and PNG/SVG variants). The class is not random — it is structurally produced by **(a)** an autosave-only product choice that ablates every classical "save" affordance, **(b)** a hook architecture that mirrors React state into refs and is therefore prone to closure/sync-vs-async drift, and **(c)** a test pyramid that mocks `<Excalidraw>` itself and so cannot oracle the API contracts that bind us to a third-party library. The single change with the highest expected payoff is making **byte-for-byte round-trip preservation of every shipped fixture** a CI gate. We could not have shipped P0-1 (`.excalidrawlib` library wipe) under that gate.

This document is mandatory reading before any future change to `src/hooks/useExcalidraw*`, `src/lib/excalidraw/`, `src-tauri/src/commands/fs_write.rs`, `src-tauri/src/commands/close_flush.rs`, or any new feature that writes user files. Every section ends with concrete, citable additions to principles, patterns, tests, or process.

---

## Section 1 — Inventory of every data-loss-class bug across iterations

The bug-class definition: **any defect that can cause user-authored bytes to fail to land on disk, to land in the wrong place, or to be silently overwritten by stale or empty content.** Includes near-misses: cases where the data was preserved by luck of timing or by an unrelated guard.

Citations are commit SHA + iter number; file paths cite the post-fix tree unless noted. Source: `iter-bodies.txt` and the iter-20 ship-readiness review (`plan.md`).

| # | Iter introduced | Iter discovered | Latency | Discovered by | Class (§2) | One-line root cause | Citation |
|---|---|---|---|---|---|---|---|
| 1 | iter-3 | iter-5 | 2 | user dogfood | 5 termination | Closing an EDITED tab silently discarded the buffer — no close-confirm. | `8ee8d5a` iter-5 P0 close blockers |
| 2 | iter-3 | iter-6 | 3 | user dogfood | 5 termination | Window X / Alt-F4 / Cmd-Q bypassed `closeTab()`, no prompt at all. | `dfcc0e5` iter-9 BUG#1 table |
| 3 | iter-3 | iter-7 | 4 | user dogfood | 7 state-ambiguity | "First onChange = mount, all subsequent = edits" heuristic flipped `dirty=true` on every tool/sidebar/viewport tick → real edits indistinguishable from noise → close-confirm stopped firing for the right reason. | `f1e9f81` iter-7 ISSUE 3 |
| 4 | iter-3 | iter-7 | 4 | user dogfood | 1 wrong-API-surface | `.excalidrawlib` parsed as a scene (`elements`); library grid invisible; saving wrote `elements: []` over the curated palette. | `f1e9f81` iter-7 ISSUE 4 |
| 5 | iter-7 | iter-8 | 1 | user dogfood | 1 wrong-API-surface | Sidebar payload `{ name: "library" }` did not match Excalidraw's `{ name: "default", tab: "library" }` registry → grid never opened (visible symptom of the same class as #4). | `a025314` iter-8 BUG#3 |
| 6 | iter-7 | iter-8 | 1 | user dogfood | 8 test-oracle | Pre-set baseline hash drifted vs Excalidraw's mount-time normalisation passes (versionNonce/seed bumps); freshly-mounted file read as dirty without input → close-confirm fired on no-op edits. | `a025314` iter-8 BUG#2 |
| 7 | iter-8 | iter-9 | 1 | user dogfood | 8 test-oracle | iter-8 fix worked under Vite-dev fixtures (fast mount, few normalisation ticks) but failed under real WebView2 (unbounded normalisation window). The unit test stubbed `<Excalidraw>` and asserted the buggy contract green. | `dfcc0e5` iter-9 BUG#2 |
| 8 | iter-3 / iter-10 | iter-11 review | 1–8 | bug-expert | 4 watcher echo / 3 cleanup-discard | iter-10 redesign deleted the writers for `excalidrawDirtyByTab` and `recordSave()` — three downstream consumers (TabBar dirty-dot, conflict-banner gate, watcher self-write suppression) silently disabled. External edits silently overwritten; own-saves looped through the watcher; tab-switch mid-debounce lost edits. | `d95ceee` iter-11 D1–D4, D6 |
| 9 | iter-10 | iter-11 | 1 | test-expert + bug-expert | 3 cleanup-discard | Cleanup on unmount **cancelled** the pending debounce instead of flushing it. Tab switch within 2 s → user's edits dropped on the floor. | `d95ceee` iter-11 D1 |
| 10 | iter-10 | iter-11 | 1 | bug-expert | 3 cleanup-discard | Post-unmount ghost save: `.then`/`.catch`/`.finally` arms scheduled follow-up work after the component unmounted, racing the next mount. Required `mountedRef` guards. | `d95ceee` iter-11 D4 |
| 11 | iter-10 | iter-11 | 1 | bug-expert | 2 sync-vs-async race | Stale-closure on mode flip: timer scheduled in render N captured render-N's `mode` and ran a write after a Visual-mode switch. Required ref-mirror pattern around `performSave`. | `d95ceee` iter-11 D6 |
| 12 | iter-11 | iter-12 | 1 | bug-expert | 1 wrong-API-surface | `stableContentHash` did not include the persisted appState slice (`viewBackgroundColor`/`gridSize`/`gridStep`/`gridModeEnabled`). Pure-appState edits silently bypassed save. The hash function strips fields it knows are volatile but had a hand-written **persist** allowlist that did not match Excalidraw's `cleanAppStateForExport`. | `022cd3e` iter-12 CRITICAL #1 |
| 13 | iter-11 | iter-12 | 1 | bug-expert | 3 cleanup-discard | `pendingSaveRef` not drained on unmount (fire-and-forget). Tab-switch / window-close mid-save discarded queued edits. | `022cd3e` iter-12 CRITICAL #2 |
| 14 | iter-3 | iter-12 | 9 | bug-expert | 2 sync-vs-async race | Reload handler dispatched `mdownreview:file-changed` BEFORE clearing `excalidrawDirty` and resetting the autosave baseline → race between the file re-read and an in-flight save → either reload skipped or stale draft reapplied. | `022cd3e` iter-12 CRITICAL #3 |
| 15 | iter-3 | iter-12 | 9 | bug-expert | 5 termination | Tauri `WindowEvent::CloseRequested` fired no flush handshake — full debounce window's worth of edits lost on every close. Required new IPC: `mark_close_flush_ready` + `close_flush_complete` + 2.5 s timeout. | `022cd3e` iter-12 CRITICAL #4 |
| 16 | iter-12 | iter-14 | 2 | bug-expert | 4 watcher echo | Self-write suppression entry leaked across `write_atomic` failures, silently absorbing legitimate external mutations for 1500 ms after a failed write. Move-to-Ok-arm fix. | `6c0074b` iter-14 / `fs_write.rs:fs_write_failure_does_not_register_self_write_suppression` |
| 17 | iter-11 | iter-14 | 3 | bug-expert HIGH | 2 sync-vs-async race | `autoSavePaused` read from render-time closure inside `retryAfterFailure`. `setState(false)` then same-render `performSave` still saw `paused=true` → Retry was a no-op until the next user edit. | `6c0074b` iter-14 |
| 18 | iter-11 | iter-14 | 3 | bug-expert MEDIUM | 7 state-ambiguity | `notifyChange` set `dirty=true` on every onChange (including viewport pan / tool-select with no persistent drift). External writes within the 2 s debounce raised spurious conflict banners → user clicks Reload → real edits lost. | `6c0074b` iter-14 |
| 19 | iter-3 | iter-18 | 15 | user dogfood | 1 wrong-API-surface | PNG/SVG saves passed `exportEmbedScene` as a top-level option; Excalidraw 0.18 reads it from `appState.exportEmbedScene` only. PNGs written with no tEXt chunk; SVGs without metadata. Round-trip silently broken — user reopens a "saved" PNG and sees an empty canvas. | `50748d0` iter-18 |
| 20 | iter-3 | iter-20 | 17 | bug-expert P1 | 7 state-ambiguity / 8 test-oracle | "Saved" pill flashed on Cmd+S even when the save was paused/skipped/no-diff — the most prominent affordance for "your bytes landed" lied to the user. | `2157b22` iter-20 B1 |
| 21 | iter-3 | iter-20 | 17 | bug-expert P1 | 2 sync-vs-async race | Reload during in-flight save: pre-Reload draft persisted on disk under self-write suppression after the freshly-loaded external version. `voidInFlightSaveRef` flip required. | `2157b22` iter-20 B2 |
| 22 | iter-3 | iter-20 | 17 | bug-expert P1 | 5 termination | "Keep my edits (overwrite disk)" deferred the write until next onChange — a quit/power-loss between click and next edit silently dropped the divergent in-memory version. | `2157b22` iter-20 B3 |
| 23 | iter-3 | iter-20 | 17 | bug-expert SUSPECTED | 2 sync-vs-async race | `externalChangePending` ref-mirror via `useEffect` opened a same-tick window where a click handler that flipped pending=false then called flush() still saw the stale ref=true (read replaced by `useStore.getState()`). | `2157b22` iter-20 |
| 24 | iter-3 | iter-21 | 18 | bug-expert P0 | 1 wrong-API-surface | **`.excalidrawlib` LIBRARY WIPE.** `useExcalidrawAutoSave` read `live.libraryItems` from `<Excalidraw onChange>`'s `appState`. That field does not exist on the scene-tick appState — Excalidraw separates scene state and library state, surfacing the latter only via `onLibraryChange`. `saveScene` fell through to `[]`; serialized empty library on every save; working-tree fixture went 226 → 6 lines. | `4c4c2e7` iter-21 P0-1 |
| 25 | iter-3 | iter-21 | 18 | bug-expert P0 | 2 sync-vs-async race | **Reload-stale-content.** Conflict-banner Reload bumped `reloadKey` synchronously; `<Excalidraw key=…>` remounted with OLD `initialData` before the async re-read returned; next user edit autosaved stale draft over external version. | `22ef23f` iter-21 P0-2 |
| 26 | iter-11 | iter-21 | 10 | product-expert P0 | 6 affordance gap / 7 state-ambiguity | **Dismiss-during-pause.** SaveErrorBanner showed identical `[Resume] [Dismiss]` in both recoverable-error and 3-strike-paused states. Dismiss while paused removed the banner without resuming autosave → user kept drawing into an autosave-disabled session with zero feedback; edits lived in RAM until best-effort close-flush. | `4c3e305` iter-21 P0-3 |
| 27 | iter-10 | iter-21 | 11 | product-expert P0 | 6 affordance gap | **No persistent save-state indicator.** Autosave-only + no Save button + transient `SavedPill` (1.5 s, Cmd-S only) → after a 2 s debounce the user had zero affordance to confirm "my last 90 seconds are on disk." Bare-minimum below VS Code, Figma, Google Docs. | `4c3e305` iter-21 P0-4 |

**Distinct bugs in the data-loss class: 27 across 18 iterations.** Of those, 8 (#1, #2, #3, #4, #5, #7, #19, plus the iter-7-introduced root cause for #6) were discovered by user dogfooding *after* CI was green; the other 19 by expert review or follow-on iteration. The longest discovery latency was 18 iterations (P0-1, P0-2: introduced at iter-3 / iter-10, found at iter-21).

> **Most damning observation:** the canonical `.excalidrawlib` fixture (`samples/excalidraw/3-icons.excalidrawlib`) was wiped from 226 lines to 6 lines on every autosave during iters 3–20, and this was caught only by `git diff` after the iter-20 ship-readiness review prompted manual inspection. **Every CI pipeline of every PR iteration was green while this was happening.**

---

## Section 2 — Root cause taxonomy

Nine buckets cover all 27 bugs. For each, the **anatomy** of the failure mode and the **earliest test layer** that could have caught it.

### Class 1 — Wrong-API-surface (5 bugs: #4, #5, #12, #19, #24)
**Anatomy.** Code reads from or writes to a payload field that does not carry the data it appears to carry, OR uses a constructor shape the callee does not accept. Always tied to a third-party API contract (Excalidraw 0.18) that has no static type guard.
**Examples.** `.excalidrawlib` parsed as `elements` (#4); `openSidebar: { name: "library" }` instead of `{ name: "default", tab: "library" }` (#5); `stableContentHash` allowlist not equal to Excalidraw's `cleanAppStateForExport` keys (#12); `exportEmbedScene` at top-level instead of `appState.exportEmbedScene` (#19); `appState.libraryItems` instead of `excalidrawAPI.getLibrary()` / `onLibraryChange` (#24).
**Earliest detection point.** A round-trip property test at the **library boundary** — `loadScene → notifyChange + notifyLibraryChange → saveExcalidrawFile → loadScene` — would have caught all five. Every one of these survived because our unit tests stubbed `<Excalidraw>` itself and asserted the prop *we* passed in, not the bytes Excalidraw would emit. (See test-expert review §"weak oracles" — the `PERSISTED_APPSTATE_KEYS` audit was self-referential, asserting equality with a hand-written set.)

### Class 2 — Sync-vs-async race (6 bugs: #11, #14, #17, #21, #23, #25)
**Anatomy.** A piece of React state is mutated synchronously (a click handler, a `setState`, a key bump) while the data needed to make that mutation correct is still arriving asynchronously. The two arrivals interleave; whichever arrives first wins; in practice the synchronous write wins and the async data is silently dropped.
**Examples.** Reload bumps `reloadKey` BEFORE async re-read returns (#25); `excalidrawDirty` cleared after `mdownreview:file-changed` dispatch (#14); `voidInFlightSaveRef` not flipped at Reload click time, in-flight save continues into post-Reload state (#21); ref-mirror via `useEffect` lagging by one tick (#23); render-N closure timer firing in render N+M (#11); `autoSavePaused` ref not flipped synchronously in `retryAfterFailure` (#17).
**Earliest detection point.** Component-level Vitest with `vi.useFakeTimers` + a deterministic IPC mock that returns Promises whose resolution is gated by the test driver — exactly what iter-21 added for P0-2 (`useExcalidrawScene loadVersion` test). The reason these escaped is that until iter-21, our unit tests resolved IPC stubs synchronously, collapsing the async race window to zero.

### Class 3 — Cleanup-on-unmount discard (3 bugs: #9, #10, #13)
**Anatomy.** Pending work is tossed when the component unmounts. A debounced timer is `clearTimeout`'d; an in-flight Promise is detached without a `.finally` that re-invokes the writer; an "if mounted, save" guard fires after the unmount.
**Examples.** Cleanup *cancelled* the debounce instead of flushing it (#9); `.then` arms ran setState on unmounted components (#10); `pendingSaveRef` not drained (#13).
**Earliest detection point.** Component test that mounts `<ExcalidrawView>`, fires onChange, **immediately unmounts**, and asserts that the IPC was called. Trivial to write; was never present until iter-11 — and was added only as a regression test, not as a contract-driven test. Should be a CI gate (see §6).

### Class 4 — Watcher echo / self-write loop (3 bugs: #8, #16, plus the implicit `recordSave` gap that #8 enumerated)
**Anatomy.** The app's own write triggers a file-system event that the app re-interprets as an external change, which then either fights live state or trips the conflict banner that silently destroys the user's edit if they click "Reload."
**Examples.** Self-write suppression leaked across failed writes (#16); recordSave never primed by iter-10 redesign (#8 D3); P1-7 (still open after iter-21): registration keyed on user-supplied filename casing, watcher reads canonical-cased path, keys diverge on Windows.
**Earliest detection point.** Native E2E (`08-excalidraw-real-write.spec.ts`) — but the spec as shipped tests the IPC directly and bypasses the canvas. A real onChange→debounce→save→watcher→reload round-trip on a real Tauri build is the only oracle that catches this layer. Per test-expert review, gap #1.

### Class 5 — Termination-path skip (4 bugs: #1, #2, #15, #22)
**Anatomy.** Data is lost because some specific exit/quit/destroy path skips the persistence step.
**Examples.** Close-tab discarded buffer with no confirm (#1); window-X bypassed `closeTab` (#2); `WindowEvent::CloseRequested` fired no flush handshake (#15); "Keep my edits" deferred the write until next onChange and lost it on quit/power-loss (#22). **Still open per tauri-architect-expert P1-8:** macOS Cmd+Q fires `RunEvent::ExitRequested`, not per-window `CloseRequested` — the close-flush handshake does not cover it.
**Earliest detection point.** Native E2E with explicit close-path coverage. Today's matrix is incomplete: Tab-X / Ctrl-W / Window-X / Alt-F4 / Cmd-W / Cmd-Q / Quit-from-menu / system-shutdown — at least 8 distinct paths, and we covered them piecemeal as user reports came in.

### Class 6 — Affordance gap (2 bugs: #26, #27)
**Anatomy.** No UI signal that the user's edit hasn't landed yet, or worse: a UI element that previously meant "saved" no longer does after a redesign.
**Examples.** Dismiss-during-pause looked like a closure (#26); no persistent save indicator (#27).
**Earliest detection point.** Product review against a written acceptance criterion that **enumerates the autosave-only contract** (every product that hides Save MUST ship a persistent dirty/saving/saved indicator and an undismissable error state). We had no such contract; the autosave-only pivot was a 4-bullet-point design note in iter-10's commit body.

### Class 7 — State-machine ambiguity (3 bugs: #3, #18, #20)
**Anatomy.** Two semantically-distinct states render identically, so the user cannot distinguish them and downstream code (e.g. close-confirm guards) cannot either.
**Examples.** "First onChange = mount" heuristic (#3); `dirty=true` on viewport pan (#18); SavedPill flashed on no-write (#20).
**Earliest detection point.** A state-machine specification (states + transitions + invariants) embedded in `docs/features/excalidraw.md` and consumed by a property-based test that asserts e.g. "for every state s, transitioning out of s and back leaves the on-disk bytes unchanged."

### Class 8 — Test-oracle drift (2 bugs: #6 + #7 root cause)
**Anatomy.** A passing test asserts wrong behavior or stub-tests instead of contract-tests.
**Examples.** iter-8 BUG#2 fix worked in test fixtures (faster mount) but failed in real WebView2 (#7); pre-iter-18 saveScene tests asserted the buggy `exportEmbedScene` top-level contract — they were green, locking in the bug. The test-expert review's audit of `PERSISTED_APPSTATE_KEYS` self-reference is a still-open instance.
**Earliest detection point.** This is a **gate failure**, not a bug-detection failure. The fix is structural: contract tests must drive their oracle from the third-party library's actual emitter, never from a hand-written allowlist. Cited as test-strategy.md rule 28 (data fidelity) which we admittedly violate in `stable-hash.test.ts`.

### Class 9 — Doc-vs-code drift (1 bug: documentation-review #5)
**Anatomy.** Aspirational doc claim that contradicts shipped code, hiding a real gap. Not a data-loss bug *per se*, but one of the load-bearing principles (`docs/principles.md` carve-out) described two banners + un-de-jargonized strings while the code shipped one banner + new strings — the same PR. A future maintainer challenging the Non-Goal would reach the wrong conclusion.
**Earliest detection point.** Ship-readiness gate: `documentation-expert` agent run before any merge that touches the carve-out doc.

---

## Section 3 — Principle gaps

Each meta-principle is evaluated against the bugs we shipped. Where a principle was qualitatively right but lacked a teeth-bearing rule, that gap is named and a concrete addition is proposed.

### Reliable pillar (`docs/principles.md`, charter table)

> *"Comments are indestructible; refactors, deletes, and crashes do not lose them."*

The pillar is the right intent but worded for the comments domain. **Excalidraw shipped an editor-grade write surface under a viewer-grade reliability principle.** Bugs #1, #2, #15, #22, #26, #27 are all reliability misses on the *file content* axis that the pillar wording does not directly cover.

**Proposed rewording (principles.md):** "**Reliable.** Every byte the user has authored — comments, viewer-edited file content, sidecar state, settings — is durable across crashes, refactors, terminations, third-party-library version bumps, and power loss. A feature that writes user files inherits a reliability obligation no weaker than the comments-pillar baseline. Autosave-only features explicitly inherit the [single-source ref pattern](#) (§4) and the [must-acknowledge banner pattern](#) (§4)."

### Meta-principle 1 — Rust-First with MVVM

Rust-first did **not** prevent the data-loss class. P0-1 (#24) and bug #12 are pure renderer-side wrong-API-surface failures: the Rust write IPC was correct; the renderer handed it the wrong bytes. Rust-First as currently written ("Rust is the Model: data + business logic over typed Tauri commands") is silent on the **payload provenance** problem.

**Specific cases the principle would have caught — given a stronger qualification:**

- #12 (appState slice): if the principle required *every payload field to declare its source surface*, the per-tick hash function would have had a docstring saying "library items: `excalidrawAPI.getLibrary()` (NOT `appState.libraryItems`)."
- #19 (PNG embed-scene flag): same — the `exportEmbedScene` field would have a single declared source (`appState.exportEmbedScene`), making the top-level call site obviously wrong on grep.
- #24 (P0-1): direct miss.

**Proposed addition (architecture.md, new rule 33):** **"Single-source ref. Every reactive value derived from a third-party API is held in exactly one ref/state location, declared with a code-level citation of the API surface it is sourced from in its declaration site comment. The corresponding setter is the only writer. A consumer that needs the value reads the ref; it does not re-derive it from another API surface. Canonical: `liveLibraryItemsRef` in `useExcalidrawAutoSave.ts` is sourced exclusively from `<Excalidraw onLibraryChange>`; `liveSceneRef` is sourced exclusively from `<Excalidraw onChange>`. Violations: any field read on the wire that is also computable from a different API surface within the same file."**

### Meta-principle 2 — Never Increase Engineering Debt

Many of the bugs are direct debt: TODOs (`_externalChangePending` dead param, `void getDefaultView`), comments like "redundant defensive call" (iter-18.1) that turned out to be actively harmful (#11 stale-closure relative). The principle correctly prohibits these but was not enforced PR-by-PR; debt accumulated across iters and was paid down only at iter-17 (refactor) and iter-20 (review).

**Specific cases:** the iter-10 redesign (#8, #9, #10, #11, #13) deleted ~720 LoC of manual-save flow but left three downstream consumers (TabBar, conflict-banner gate, watcher) wired to setters that no longer fired. **A delete is not safe if it leaves the call sites that depend on the deleted writer.** A static analysis check for "has this setter lost all its callers?" would have caught five bugs at once.

**Proposed addition (architecture.md, new rule 34):** **"Setter-completeness. When a setter for a Zustand slice or a ref is removed or renamed, every read site of that slice/ref must be co-evaluated: (a) is the read still meaningful? (b) is there a new writer that re-establishes the contract? Lint or grep gate: `setExcalidrawDirty` etc. cannot be deleted without its read sites being deleted in the same commit, or a new writer cited."**

### Meta-principle 3 — Zero Bug Policy

Zero Bug Policy is the right principle but is **detection-bound**: a bug we did not detect during PR review is not subject to the policy. Of our 27 bugs, 8 were reported by user dogfood after CI green. That is not zero; that is "we cap at the rate of user-driven discovery."

**Proposed addition (principles.md meta-principle 3):** "**…and every confirmed bug ships with a regression test that fails before the fix and passes after. For features that write user files, the regression test must run at the IPC boundary or higher (see test-strategy.md §round-trip gate)** — a unit test that mocks the writer is not sufficient regression coverage for a write-path bug."

### Meta-principle 4 — Proper Fix Over Patch

Proper Fix Over Patch is the principle most clearly lived during this PR (the iter-16 generic close-flush refactor; the iter-20 typed-error contract; the iter-21 commit-aligned remount via `loadVersion`). But several violations were tolerated PR-internally:

- The synthetic `mdownreview:file-changed` `CustomEvent` forging (react-coding-expert P1 #1, iter-12) — Reload dispatches a watcher-only event to fool `useFileContent`. Fix is "use a `forceReload(path)` action," not "dispatch the wire event."
- The `eslint-disable react-hooks/exhaustive-deps` with comment "deliberate empty deps" inside `useExcalidrawAutoSave` `useCallback` arms.

These are **not** data-loss bugs but they are how the next data-loss bug will be born.

### Meta-principle 5 — Docs Reflect Shipped Code

Doc-vs-code drift directly produced bug #5 (sidebar payload — the doc and the code had different shapes; the doc was right) and the principles.md carve-out drift (documentation-review #5). The principle is right; the gate is **temporal** — docs are checked at PR-merge time but not at iter-N intermediate commits, so drift accumulates and is paid down in batches by `documentation-expert`.

**Proposed addition (architecture.md, new rule 35):** **"Carve-out reciprocity. Any feature that violates a Non-Goal (e.g. the Excalidraw editor exception to viewer-not-editor) MUST have its carve-out paragraph in `docs/principles.md` and feature page in `docs/features/` updated **in the same commit** as the code that introduces or modifies the carve-out behavior. The `documentation-expert` agent's per-PR run is the gate."**

---

## Section 4 — Pattern gaps

`docs/design-patterns.md` has 24 numbered rules. None of them name the patterns that would have prevented our P0s. We propose six additions.

### 4.1 Single-source ref pattern → `docs/best-practices-project/single-source-ref.md`
**Trigger:** any reactive value derived from a third-party API. **Canonical:** `liveLibraryItemsRef` (post-iter-21) at `src/hooks/useExcalidrawAutoSave.ts:103-108`, declared with explicit citation `// Library items are exposed only via <Excalidraw onLibraryChange>; appState.libraryItems on scene-tick is null.`. **Anti-pattern:** the pre-iter-21 `live.libraryItems ?? appState.libraryItems ?? []` chain in `saveScene.ts`, which encoded the ambiguity as a fallback. **Lint:** any `??` chain across two API-surface reads is a code-review smell.

### 4.2 Commit-aligned remount pattern → `docs/best-practices-project/commit-aligned-remount.md`
**Trigger:** any React `key={...}` whose change is gated on async-loaded content. **Canonical:** post-iter-21 `useExcalidrawScene` returns a `loadVersion` that increments only after a successful parse-or-extract commit; `<Excalidraw key={loadVersion}>` remounts only when fresh `initialData` is available. **Anti-pattern:** synchronous `setReloadKey(k => k+1)` in a click handler. **Rule of thumb:** "the key changes when the data the key gates is ready, never when the user clicks the button that requests new data."

### 4.3 Must-acknowledge banner pattern → `docs/best-practices-project/must-acknowledge-banner.md`
**Trigger:** any banner that signals an unsafe state (autosave paused, save failed, in-flight conflict). **Canonical:** post-iter-21 `SaveErrorBanner` hides Dismiss in the paused state — Resume is the only way out. **Anti-pattern:** identical button affordances in both safe and unsafe states. **Test contract:** for every banner with a "[Dismiss]" button, assert the banner state-machine has **no transition** to a state where the underlying invariant is unsafe AND the banner is hidden.

### 4.4 Write-through-acknowledgment pattern → `docs/best-practices-project/write-through-ack.md`
**Trigger:** any autosave-only viewer/editor. **Canonical:** post-iter-21 persistent `SaveStatusIndicator` (saved / unsaved / saving / failed) at `ExcalidrawView.tsx:300+`. **Rule:** "if a user can edit and there is no Save button, the UI must, at all times, name a state from {saved | dirty | saving | failed}." **Anti-pattern:** transient pills + nothing else (the iter-10 → iter-20 baseline).

### 4.5 Typed-failure-contract pattern → `docs/best-practices-project/typed-failure-contract.md`
**Trigger:** any IPC call inside a critical termination path (close-flush, app-quit). **Canonical (proposed; not yet shipped):** `closeFlushComplete` returns `Result<{ failed_paths: string[] }, _>` so the Rust handler can prompt "Save Again / Discard / Cancel" instead of silently destroying the window. **Anti-pattern:** `void`-returning ack IPCs whose failure is logged-then-swallowed. Bug #6 (open).

### 4.6 Canonicalized-key pattern → `docs/best-practices-project/canonicalized-key.md`
**Trigger:** any path-keyed map crossing the FS-boundary (watcher state, suppression registry, mounts registry). **Canonical (proposed):** the value passed in by callers must be canonicalized via `canonicalize_no_verbatim` exactly once, at the public-API boundary; downstream code reads/writes only that canonical form. **Anti-pattern:** registering under one casing and reading under another (P1-7, still open).

These six files belong in `docs/best-practices-project/` (project-specific knowledge files), not in the project-agnostic patterns that review agents bundle in their `knowledge/` folders. Each file should have a one-paragraph trigger, the canonical example with a file:line citation, the anti-pattern with a contrasting citation, and a test-pattern showing how to assert compliance.

---

## Section 5 — Product-choice gaps

This section is honest about the product decisions that **made the data-loss class likely**. None of them were necessarily wrong; all of them shipped without an architectural mitigation.

### 5.1 Autosave-only (iter-10 redesign)
**Surface opened.** Removing the Save button removed the user's primary mental affordance for "I have committed my work." Every classical writer-app reliability mechanism (dirty-dot, `*` in title bar, document-edited bullet, Cmd+S responsiveness, "you have unsaved changes" prompt) was either deleted or hidden behind a 1.5 s pill. The user-visible surface area where the system could lie went from 0 to many: a save could fail, be paused, be skipped, or be racing an external write, and the user could not tell.
**Spec gap.** iter-10's commit body documents the decision in 4 bullet points. There is no enumeration of the affordance contract that autosave-only inherits. P0-3 and P0-4 are direct consequences.
**Proposed addition (`docs/features/excalidraw.md` § Save semantics):** "**Autosave-only contract.** Any tab whose viewer writes user files without an explicit Save button MUST ship: (a) a persistent save-state indicator (saved / unsaved / saving / failed); (b) a must-acknowledge error state when the autosave loop is paused; (c) a deterministic close-flush handshake that surfaces failure to the user; (d) a Cmd+S code path that always acknowledges receipt (real write, no-diff message, or the failure pathway above)."

### 5.2 Viewer-not-editor positioning + the carve-out
**Tension.** Principles.md is unambiguous: "viewer-not-editor." The carve-out for `.excalidraw` editing is explicit but its **reliability budget** is implicit. Does the carve-out inherit viewer-grade reliability ("we don't lose comments") or editor-grade ("we don't lose anything the user typed")? The 27 bugs in §1 prove that we shipped under the *first* and the user expected the *second*.
**Proposed addition (principles.md carve-out paragraph):** "Excalidraw editing is held to **editor-grade reliability**: every byte the user has authored is durable across crashes, refactors, and library version bumps. The carve-out's continued existence is conditional on (a) round-trip preservation tests for every shipped fixture being CI-green, and (b) zero open data-loss-class P0s in `docs/retrospectives/`. If either condition fails for two consecutive releases, the carve-out is reverted and Excalidraw becomes view-only."

### 5.3 The "save action is invisible" tradeoff
**Acceptable for the user model?** Our user model is "developer reviewing AI agent output." That user has muscle memory for Cmd+S. Pre-iter-21 the keystroke was intercepted (good — no browser Save Page) but had no acknowledgment when there was no diff. Bug #20 made it lie. Acceptable only if the persistent indicator is rock-solid. Post-iter-21 it is.

### 5.4 Persistence target ambiguity for `.excalidrawlib`
**The single biggest spec miss.** `.excalidraw` files have **scene state**; `.excalidrawlib` files have **library state**. Excalidraw the library treats these as orthogonal — different on-screen UIs (canvas vs palette grid), different change events (`onChange` vs `onLibraryChange`), different serializers. Our spec collapsed both onto a single "persist on autosave" pipeline. **The mental model "the active file is what gets saved" is correct for `.excalidraw`; for `.excalidrawlib` the active file is a library and the live state is a curated palette emitted on a different callback.** P0-1 is the direct consequence.
**Proposed product-spec template addition:** "For every file extension the feature handles, the spec must enumerate (a) the read source (which API call / file shape produces the in-memory representation), (b) the write source (which event fires when the user mutates the in-memory representation), (c) the serialization function. If any of (a/b/c) differs across extensions, an extension-keyed dispatch table is required and must be the single source of truth."

### 5.5 Conflict-banner UX (Reload vs Keep my edits)
**Mismatch.** A binary choice does not match the failure modes that arise in practice. If the on-disk change came from a build script that auto-formatted the JSON, "Reload" silently destroys the user's last few minutes; "Keep my edits" silently destroys the formatter's work. We need a third option, or at least a diff preview. Iter-20 partially addressed this with asymmetric button styling, but the underlying UX is still binary-destructive-either-way. Product-expert review §"P1 conflict banner."

---

## Section 6 — Testing & validation gaps

For each bug class in §2, the test layer that **should** have caught it vs the layer that **did**:

| Class | Should-catch layer | Did-catch layer | Gap |
|---|---|---|---|
| 1 wrong-API-surface | Round-trip property test (lib boundary) | User dogfood / bug-expert | We mock `<Excalidraw>` itself; oracles are self-referential. |
| 2 sync-vs-async race | Component test with controllable IPC promise | Bug-expert (suspicion), iter-21 unit test | We resolve IPC stubs synchronously, collapsing the race window to zero. |
| 3 cleanup-on-unmount | Component test: mount → fire → immediate unmount → assert IPC | Bug-expert | Was added as regression-only, never as contract gate. |
| 4 watcher echo | Native E2E with real watcher | Bug-expert (one) / open (one) | `08-excalidraw-real-write.spec.ts` bypasses the canvas. |
| 5 termination-path | Native E2E across all close paths | User dogfood | Path matrix incomplete; macOS Cmd+Q still uncovered. |
| 6 affordance gap | Product review / acceptance criteria | Product-expert iter-20 | No autosave-only contract template. |
| 7 state-machine ambiguity | Property-based state-machine test | User dogfood / bug-expert | No state-machine spec exists. |
| 8 test-oracle drift | Mutation testing | Bug-expert audit | No mutation testing in CI. |
| 9 doc-vs-code drift | `documentation-expert` per-PR | Iter-20 ship-readiness | Run cadence is too sparse. |

### 6.1 Round-trip CI gate (the single most important addition)

**Proposal.** Add `src/lib/excalidraw/__tests__/saveScene.roundtrip.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { loadExcalidrawScene } from "@/lib/excalidraw/extractScene";
import { serializeAsJSON, serializeLibraryAsJSON } from "@excalidraw/excalidraw";

const FIXTURES = ["3-icons.excalidrawlib", "canonical.excalidraw", /* … */];
const VOLATILE = new Set(["version", "versionNonce", "updated"]);

const stripVolatile = (obj: unknown): unknown =>
  Array.isArray(obj) ? obj.map(stripVolatile)
    : obj && typeof obj === "object"
      ? Object.fromEntries(Object.entries(obj).filter(([k]) => !VOLATILE.has(k)).map(([k, v]) => [k, stripVolatile(v)]))
      : obj;

describe.each(FIXTURES)("round-trip preservation: %s", (fixture) => {
  it("loadScene → serialize emits byte-equivalent JSON modulo volatile fields", async () => {
    const raw = await fs.readFile(path.join("samples/excalidraw", fixture), "utf-8");
    const scene = loadExcalidrawScene(raw, fixture);
    const out = fixture.endsWith(".excalidrawlib")
      ? serializeLibraryAsJSON(scene.libraryItems!)
      : serializeAsJSON(scene.elements!, scene.appState!, scene.files ?? {}, "local");
    expect(stripVolatile(JSON.parse(out))).toEqual(stripVolatile(JSON.parse(raw)));
  });
});
```

This test would have failed at iter-3 for #4 (`.excalidrawlib` mis-parse) and at every iter from 3–20 for #24 (P0-1 library wipe). **It is the single highest-payoff addition in this retrospective.** P0 in §8.

### 6.2 Property-based round-trip with adversarial fixtures
For every save format ship a property-based test that generates random valid scenes/libraries (using Excalidraw's own constructors or `fast-check` arbitraries over the schema), runs `notifyChange + notifyLibraryChange + flushAutoSave + readBack`, and asserts content-equality modulo volatile fields. Adversarial fixtures: 226-line `.excalidrawlib`, scene with embedded image files, scene with `gridModeEnabled: true`, scene with `viewBackgroundColor` non-default. Each fixture pinned by SHA in `samples/excalidraw/.fixtures.lock`.

### 6.3 IPC-boundary integration tests
The `__mocks__/@tauri-apps/api/core.ts` invoke mock should support a "deferred" mode: tests can hold the Promise resolution and inspect intermediate state. Class 2 (sync-vs-async race) bugs become trivial to write tests for. Iter-21 P0-2's `loadVersion` test is the proof-of-concept; generalize.

### 6.4 Native E2E close-path matrix
Single spec, parameterized over: Tab-X click, Ctrl-W, Window-X, Alt-F4, Cmd-W, Cmd-Q, menu Quit, system shutdown (best-effort). Each path: open file, edit (real Excalidraw onChange), close via path, reopen, assert disk has post-edit bytes. Today's native E2E covers IPC-direct only.

### 6.5 Mutation testing pilot
Pilot Stryker on `src/lib/excalidraw/` and `src/hooks/useExcalidraw*`. Hypothesis: mutation score will be < 60% because so much of our oracle is structural (did the IPC fire?) rather than semantic (did the right bytes land?). Use the result to drive Q2 test-strengthening.

### 6.6 Single CI gate (proposed)
Add to `.github/workflows/ci.yml` a `roundtrip-preservation` job: for every viewer that writes user files, a round-trip test must exist that loads a deterministic fixture, runs the full autosave cycle, and asserts byte-equality (modulo volatile fields) of post-save bytes against an expected golden. Block merges that touch the carve-out without an entry in this matrix.

---

## Section 7 — Process gaps

### 7.1 Iteration cadence is self-amplifying
22 iters in roughly 5 days. Each iter shipped fixes that introduced new bugs (iter-10 → iter-11's six data-loss bugs is the textbook case). **The autonomous iterate-loop optimizes for "ship something CI-green" — not for "ship a regression-resistant fix."** When a P0 fix touches `useExcalidrawAutoSave.ts`, the fix is regression-tested against the bug it cites, not against the rest of the hook's contract. Five iters later we discover the hook drifted; iter-21's discoveries (P0-1, P0-2) are direct consequences.

### 7.2 The iterate-loop has no data-loss adversary review pass
Today the loop dispatches generic agents (bug-expert, test-expert, product-expert) on a cadence determined by issue grooming. None of them are tasked specifically with "find the next way this code can lose user bytes." Bug-expert's iter-20 ship-readiness sweep was the first time an adversarial pass was run with that explicit framing — and it found 4 P0s in a "CI-green" PR. **The cost of running that pass on iter-1, iter-5, iter-10 would have been ~3 expert-passes; the savings would have been ~15 iterations of forward-fixes.**

### 7.3 Manual testing is happy-path-only
Every iter-N "user dogfood" report is a *new* failure mode that the developer happened to stumble across. There is no checklist; bugs surface in roughly the order the user uses the feature. The state-machine has on the order of 30 distinct (mode × dirty × paused × in-flight × external-pending × close-pending) states; we sampled maybe 8.

### 7.4 Expert review timing
The iter-20 ship-readiness sweep dispatched 9 experts in parallel. Earlier expert passes (iter-3, iter-11, iter-12, iter-14) had identical access. **Why didn't they find the P0s?** Two reasons:
- **Scope drift.** Iter-3 review focused on iter-3's diffs; iter-21 reviewed the entire PR. The iter-N review pattern misses bugs that survive *because* they are unchanged across iterations.
- **Brief framing.** Earlier reviews asked "is this iter's change correct?"; iter-20 asked "would you ship this?" The framings produce different findings.

### Process additions

**P0 — Mandatory data-loss adversary review pass.** Any feature touching `fs_write.rs`, `close_flush.rs`, `core/atomic.rs`, or any new IPC that mutates user bytes triggers a templated review with the §2 taxonomy as the checklist:
1. Wrong-API-surface: every write payload field's source surface enumerated?
2. Sync-vs-async race: every state mutation that gates a write tied to async data — has the race window been tested with deferred IPC mocks?
3. Cleanup-on-unmount: every pending write drained, not cancelled, on unmount?
4. Watcher echo: self-write suppression keyed canonically; tested across casing/symlinks?
5. Termination-path: every close path (Tab-X / Ctrl-W / Window-X / Alt-F4 / Cmd-Q / menu Quit) covered by native E2E?
6. Affordance gap: persistent saved/unsaved/saving/failed indicator visible at all times in editing surfaces?
7. State-machine ambiguity: every banner/UI state has a unique visual; no two states render identically?
8. Test-oracle drift: round-trip property test against a third-party-library-emitted fixture present in CI?
9. Doc-vs-code drift: feature page + carve-out paragraph updated in the same commit?

**P1 — Iteration cap before mandatory expert review.** Every 5 iterations on the same PR triggers a fresh full-PR expert pass (not an iter-diff pass). Iter-5, iter-10, iter-15, iter-20 — we got the iter-20 one for free; the earlier four would each have caught roughly 2–4 of the 27 bugs at the source.

**P2 — Test-fixture-pinning.** `samples/excalidraw/*.excalidraw[lib]` are user-mutable. CI must regenerate them via a deterministic script (and assert determinism), or grep-forbid automated tests from writing to them. Today they were corrupted by the autosave loop during dev and the corruption was only caught manually.

**P2 — Iterate-loop integration.** When an iterate-loop session closes a P0, append a one-line entry to `docs/retrospectives/<active>.md` with the (iter-introduced, iter-discovered, class) tuple. Continuous bug taxonomy without retrospective sprints.

---

## Section 8 — Action plan

| Pri | Title | Owner | Deliverable | Acceptance |
|---|---|---|---|---|
| **P0** | Round-trip CI test for `samples/excalidraw/*` | test-expert | `src/lib/excalidraw/__tests__/saveScene.roundtrip.test.ts` per §6.1 | Test fails when revert of `4c4c2e7` is applied; passes on HEAD. |
| **P0** | Codify single-source-ref pattern | tauri-architect-expert | New rule 33 in `docs/architecture.md` (§3 wording); apply across `useExcalidrawAutoSave`, `useFileContent`, `useFileWatcher` | Each ref has a source-citation comment; PR review will reject any new ref without one. |
| **P0** | Must-acknowledge banner pattern | tauri-architect-expert + product-expert | `docs/best-practices-project/must-acknowledge-banner.md` per §4.3 | Doc page with citations; lint or test asserts no banner has identical buttons in safe and unsafe states. |
| **P0** | Reliable-pillar rewording + autosave-only contract | tauri-architect-expert | `docs/principles.md` Reliable + Excalidraw carve-out per §3, §5.1, §5.2 | Carve-out reciprocity rule (35) cited; PR template updated. |
| **P1** | Bug-expert P1-6 (close-flush failure contract) | architect + bug-expert | `Result<{failed_paths}, _>` wire contract; user-facing prompt | Disconnected-network-drive E2E asserts user-visible "Save again / Discard / Cancel" prompt before destroy. |
| **P1** | Bug-expert P1-7 (watcher canonical-case mismatch) | bug-expert | Single-line fix in `fs_write.rs:153-163` per plan.md item #7 + Windows native E2E | E2E on Windows asserts no spurious file-changed echo on mixed-case workspace path. |
| **P1** | Architect P1-8 (macOS Cmd+Q ExitRequested) | tauri-architect-expert + react-coding-expert | `RunEvent::ExitRequested` flush handshake | Native E2E (mac-only) asserts Cmd+Q during 2 s debounce preserves bytes on disk. |
| **P1** | Property-based round-trip per format | test-expert | `fast-check` arbitraries for scene + library; CI integrated | Mutation score on `saveScene.ts` ≥ 80%. |
| **P1** | Document data-loss adversary review pass | documentation-expert | New skill `docs/skills/data-loss-adversary-review.md` per §7 | Mandatory dispatch for any PR touching `fs_write.rs` / `close_flush.rs` / autosave hooks. |
| **P1** | Commit-aligned remount pattern doc | tauri-architect-expert | `docs/best-practices-project/commit-aligned-remount.md` per §4.2 | Pattern referenced from `useExcalidrawScene.ts` `loadVersion` declaration. |
| **P2** | Mutation testing pilot | test-expert | Stryker config on `src/lib/excalidraw/` + `src/hooks/useExcalidraw*` | Baseline mutation score reported; uncovered mutants triaged into 5 follow-up tests. |
| **P2** | Test-fixture-pinning CI gate | test-expert | Determinism check + grep-forbid on `samples/excalidraw/` | CI fails if a sample file's SHA differs from `.fixtures.lock` and no regen-script-output marker is present. |
| **P2** | Iteration-cap review process | tech lead | `.github/PULL_REQUEST_TEMPLATE.md` checkbox: "[ ] Iter ≤ 5 since last full-PR expert pass" | Honor system; auditable via PR commit count. |
| **P2** | Single-source ref / canonicalized-key / typed-failure-contract / write-through-ack pattern docs | tauri-architect-expert | Four files in `docs/best-practices-project/` per §4.1, §4.4, §4.5, §4.6 | Each doc has trigger + canonical example + anti-pattern + test-pattern. |
| **P2** | Drain remaining test-expert + documentation-expert review items | test + docs experts | All remaining iter-20 P1/P2 review items per `plan.md:42-46` | Each item is closed or explicitly deferred with a tracking issue. |

---

## Section 9 — Closing

**The one change with the highest expected payoff: making byte-for-byte round-trip preservation of every shipped fixture a CI gate.**

Of the 27 bugs in §1, **at least 9** (#4, #5, #6, #7, #12, #19, #20, #24, plus the iter-7 root cause of #6) — including both iter-21 P0s (#24 and indirectly #25) — would have been caught at the iter at which they were introduced by a single round-trip test like §6.1: load each `samples/excalidraw/*` fixture, run the full autosave cycle, assert byte-equality modulo Excalidraw's volatile `version` / `versionNonce` / `updated` fields.

That gate is roughly 60 lines of test code. It is pure addition (no regression risk — failing the gate after the fact only blocks merges that legitimately broke round-tripping). It would have collapsed the discovery latency on the worst bug in this PR — the `.excalidrawlib` library wipe that destroyed a 226-line fixture on every save, undetected from iter-3 to iter-21 — from **18 iterations to 0**.

Every other proposal in this retrospective is downstream of that one observation: the pattern docs codify the mental moves the gate forces on us; the principle additions tell the team why the gate is mandatory; the process changes ensure the gate is wired into review timing. Ship the gate first. Then ship the rest.

---

*Authored 2026-05-03 against PR #353 HEAD `4c3e305`. Citations verified against `iter-bodies.txt`, `plan.md`, and the post-iter-21 working tree. Before next data-loss-class change to this code, re-read §2 and §6.1.*
