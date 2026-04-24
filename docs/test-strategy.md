# Test Strategy — rules for mdownreview

**Status:** Canonical. Cite violations as "violates rule N in `docs/test-strategy.md`".
**Charter:** [`docs/principles.md`](principles.md)
**Last updated:** 2026-04-23

## Principles

1. **Test-layer responsibility is fixed, not negotiable.** Every test picks the lowest layer that can prove its claim.
   **Pillars:** Reliable, Lean.
   **Rationale:** Unit/component tests run in ms; native E2E runs only in release workflow. Putting pure logic into E2E wastes seconds per assertion and erodes CI-on-every-commit discipline.

2. **Console silence is a first-class assertion.** A test that prints to `console.error`/`console.warn` is failing even if its explicit assertions pass.
   **Pillars:** Reliable, Professional.
   **Rationale:** `src/test-setup.ts:12-16` enforces this via `afterEach`; Playwright does the equivalent in `e2e/browser/fixtures/error-tracking.ts:90-115`. Don't work around the spy — fix the noise.

3. **Every bug fix ships with a regression test that first fails.** No failing-then-passing test, no fix.
   **Pillars:** Reliable.
   **Rationale:** Charter Zero Bug Policy. Without a failing-then-passing test, there is no evidence the fix addresses the reported failure mode.

4. **Rust-first for Rust logic.** Comment matching, anchoring, sidecar I/O, scanning, threading are tested in `src-tauri/tests/commands_integration.rs`, not re-tested via IPC mock.
   **Pillars:** Performant, Architecturally Sound.
   **Rationale:** The 4-step re-anchoring algorithm lives in `src-tauri/src/core/matching.rs:12`; duplicating its tests in TS drifts and misleads.

5. **IPC mocks MUST cover every command used during app init.** Missing mocks hang the app on an unresolved Promise.
   **Pillars:** Reliable.
   **Rationale:** `e2e/browser/fixtures/error-tracking.ts:53-66` already encodes safe-default fallbacks; the rule formalizes this list.

6. **Fixtures are data, not code.** Fixtures live in a single tree per layer, are read-only at test time, and are never mutated across tests.
   **Pillars:** Architecturally Sound.

## The three-layer pyramid

| Layer | What lives here | What does NOT |
|---|---|---|
| **Unit / component** (`src/**/__tests__/`, `src-tauri/src/core/*.rs #[cfg(test)]`, `src-tauri/tests/`) | Pure functions, store slice actions, React components in isolation, Rust core logic, custom hooks via `renderHook` | No IPC, no file I/O, no network, no real Shiki highlighting (mock), no real Monaco |
| **Browser integration** (`e2e/browser/`) | User-visible UI flows, keyboard shortcuts, multi-component interactions, persistence rehydration via `localStorage`, IPC event dispatch | No real Rust, no real file system, no OS events |
| **Native E2E** (`e2e/native/`) | Real Tauri binary bringing CLI args online, watcher emitting on OS file events, sidecar round-trips to disk, log file creation, auto-update harness | Anything a browser test can express |

## Coverage floors

| Layer | Target | Measured? | Current state |
|---|---|---|---|
| Zustand slice actions (`src/store/index.ts`) | 100% actions invoked, including early-return branches | No | `tabPersistence`, `openFilesFromArgs`, `recentItems`, `persistence` tests cover most; gaps listed below |
| `src/lib/*.ts` pure functions | 100% exported-symbol, 90% branch | No | All `src/lib/` files have co-located tests |
| React components with branching render | 80% branch | No | 20 component test files; `WelcomeView`, `UpdateBanner`, `ViewerRouter` co-located |
| Rust core (`src-tauri/src/core/`) | 90% line, 95% branch on `matching.rs`/`anchors.rs` | `cargo tarpaulin` not wired | 74 `#[test]` across 7 core modules + 22 integration |
| Browser E2E command mock coverage | Every init command mocked in every spec | By grep-audit in CI | 101 IPC-keyword hits across 10 specs |
| Native E2E | 0 tests that could be browser tests | Manual review | 4 specs (smoke, ipc, file-reload, scroll-stability) |

## Rules

1. Every Zustand action exported from `src/store/index.ts` MUST have a direct unit test (action called in isolation, observed via `useStore.getState()`). **Evidence pattern:** `src/__tests__/store/recentItems.test.ts:10`.
2. Every exported pure function in `src/lib/` MUST have at least three tests: happy path, empty/null input, one error path. **Evidence pattern:** `src/lib/__tests__/comment-utils.test.ts`.
3. Comment-matching branches (`src-tauri/src/core/matching.rs`) MUST each have an integration test: exact-at-original-line, exact-elsewhere, line-fallback, fuzzy, orphan. **Evidence:** `matching.rs:12` enumerates the 4 steps.
4. Every React component with a conditional render branch MUST have a test per branch. **Evidence pattern:** `ViewerRouter.test.tsx`, `DeletedFileViewer.test.tsx`.
5. Every browser E2E spec MUST mock the eleven canonical init commands: `get_launch_args`, `read_dir`, `read_text_file`, `load_review_comments`, `save_review_comments`, `check_path_exists`, `get_log_path`, `get_unresolved_counts`, `get_file_comments`, `scan_review_files`, `update_watched_files`. **Evidence:** `error-tracking.ts:53-66`; `comments.spec.ts:25-45`.
6. Safe-default fallbacks in the IPC mock (`{}`/`[]`/`undefined`) are for bootstrap safety only; tests whose outcome depends on a value MUST set it explicitly. **Evidence:** `error-tracking.ts:53-58`.
7. Native E2E specs MUST begin with a block comment explaining why this scenario cannot be a browser test. **Evidence:** `e2e/native/01-smoke.spec.ts:7-9,13-16`.
8. Tests that intentionally trigger `console.error`/`console.warn` MUST suppress with `vi.spyOn(console, "error").mockImplementation(() => {})` before the triggering action. **Evidence:** `src/components/__tests__/ErrorBoundary.test.tsx:18,33,60`.
9. A bug-fix PR without a failing-then-passing regression test is rejected by review. **Evidence:** Charter Zero Bug Policy.
10. No test file may share mutable state with another. `beforeEach` MUST reset store state (`useStore.setState({...})`) and `localStorage.clear()`. **Evidence:** `src/store/__tests__/tabPersistence.test.ts:5-8`.
11. `vi.restoreAllMocks()` in `afterEach` is mandatory and globally applied in `src/test-setup.ts:15`. Do not override locally.
12. IPC `invoke` mock return types MUST be `InvokeResult`-typed so TypeScript catches mock drift. **Evidence:** `src/__mocks__/@tauri-apps/api/core.ts:11-25`.
13. Tests MUST NOT import `invoke` or `@tauri-apps/plugin-log` directly; they mock `src/lib/tauri-commands.ts` and `src/logger.ts` via the single-file mocks.
14. Playwright browser tests MUST import from `e2e/browser/fixtures/index.ts`, never `@playwright/test` directly. Native tests import from `@playwright/test` directly. **Evidence:** `fixtures/index.ts:1`.
15. Every keyboard shortcut documented in `docs/specs/` MUST have a browser E2E test that simulates the key press and asserts the UI outcome.
16. Every user-visible error state (file missing, file too large, binary file, network offline) MUST have a component test asserting the specific error UI. **Evidence pattern:** `BinaryPlaceholder.test.tsx`.
17. Every anchor-line code path (exact/line/fuzzy/orphan) MUST produce an assertion in Rust unit tests and a round-trip MRSF test. **Evidence:** `mrsf-roundtrip.test.ts` + `core/matching.rs` tests.
18. File watcher save-loop debounce (1.5 s) MUST be tested in isolation: mock `Date.now`, assert event ignored inside window, processed outside. **Evidence gap:** `useFileWatcher.ts:7,56` currently uncovered.
19. Ghost-entry re-scan debounce (500 ms) MUST be tested: multiple `deleted` events within window coalesce to one `scanReviewFiles` call. **Evidence:** `useFileWatcher.ts:23-39`.
20. Fixture markdown files live under `e2e/fixtures/<feature>/` and `src-tauri/tests/fixtures/<feature>/` with kebab-case names. No fixture is edited by a test.
21. Every `#[test]` in `src-tauri/` is self-contained — uses `tempfile::NamedTempFile` or `tempdir`. **Evidence:** `commands_integration.rs:15,25,35`.
22. `cargo test`, `npm test`, `npm run lint`, and `npm run test:e2e` MUST all pass before a PR merges. **Evidence:** AGENTS.md.
23. Component tests MUST assert at least one user interaction (click, keyboard, typing) in addition to rendering. Render-only tests do not count toward coverage.
24. The `invoke` mock MUST be reset between tests (`vi.mocked(invoke).mockReset()` in `beforeEach`). Mock reuse across tests leaks IPC expectations.
25. Native E2E tests MUST NOT assert content a browser test already covers. Native-only claim = real binary, real OS event, real CLI arg, real disk write.

## Gaps (unenforced, backlog)

- **Untested store actions**: `recordSave`, `toggleAutoReveal`, `setGhostEntries`, `setAuthorName`, `setViewMode`, `setUpdateProgress`, `setUpdateVersion`, `dismissUpdate`. `setGhostEntries` has an equality-short-circuit branch at `store/index.ts:188-192` that is particularly untested.
- **`validatePersistedTabs` error path** (`src/store/index.ts:250-264`): `checkPath` rejection branch not exercised.
- **File-watcher save-loop debounce branch** (`src/hooks/useFileWatcher.ts:56-59`): the "ignore event within save window" path has no assertion in `useFileWatcher.test.ts`. This is the exact failure mode that causes watcher → reload → save cycles.
- **Ghost-entry debounce coalescing** (`src/hooks/useFileWatcher.ts:23-39`): coalesce of rapid `deleted` events is not asserted.
- **`openFilesFromArgs` with `folders: [""]`** (`src/store/index.ts:287-291`): last-folder-wins branch undefined behavior, untested.
- **Comment threading with orphaned reply** (`src-tauri/src/core/threads.rs`): orphaned-reply reparenting branch not obviously covered.
- **No CI grep-audit** verifying every browser spec mocks the eleven canonical commands. New specs missing one will hang on CI the first time the app calls the unmocked command.
- **No mechanical enforcement of the `mockImplementation(() => {})` rule** around `console.error` triggers. A developer can silence globally via `beforeAll`, leaking state — needs a CI grep flagging `mockImplementation` outside a `test`/`it` body.
