# Test Patterns (mdownreview-specific)

Concrete patterns for writing tests in this codebase. The **rules** live in [`docs/test-strategy.md`](test-strategy.md); this file is the **how-to** that those rules cite. Use it as the authoritative reference for IPC mock setup, event simulation, native-test wiring, and DOM selectors.

> **Scope:** mdownreview-specific. Generic test best-practices (TDD, oracle quality, layer choice) live in `docs/test-strategy.md`. Cross-stack JS perf for tests is in [`docs/best-practices/general/javascript-performance.md`](best-practices/general/javascript-performance.md).

## 1. Choosing the test layer

Default to the lowest layer that can prove the claim. Native E2E is reserved for scenarios a browser test cannot express (real file I/O, OS events, CLI args). Add the rule-13 "why native" comment at the top of every native spec — see [`docs/test-strategy.md`](test-strategy.md) rule 13.

| Scenario | Layer |
|---|---|
| Pure function, hook in isolation | Vitest unit |
| React component branches/interactions | Vitest + RTL |
| UI flow that touches IPC | Browser E2E (`e2e/browser/`) |
| Real file I/O, OS file events, watcher, CLI args, comment persistence | Native E2E (`e2e/native/`) |

## 2. Browser E2E IPC mock

Install `window.__TAURI_IPC_MOCK__` via `page.addInitScript`. Mock **all eleven** canonical init commands or the app hangs at startup (rule 9 in `docs/test-strategy.md`):

```
get_launch_args, read_dir, read_text_file, load_review_comments, save_review_comments,
check_path_exists, get_log_path, get_unresolved_counts, get_file_comments,
scan_review_files, update_watched_files
```

Reference implementation: `e2e/browser/fixtures/error-tracking.ts:53-66`.

Import `test`/`expect` from `./fixtures` (not `@playwright/test`) — the fixture wraps every test with console-error and uncaught-error detection (rule 22 in `docs/test-strategy.md`).

## 3. Simulating file-changed events (browser tests)

Browser tests do not have a real watcher. Dispatch the same DOM CustomEvent the watcher emits:

```typescript
await page.evaluate(() => {
  window.dispatchEvent(new CustomEvent("mdownreview:file-changed", {
    detail: { path: "/e2e/fixtures/file.md", kind: "content" }
  }));
});
```

The contract for this event lives in `useFileWatcher.ts:51-73` and rule 13 in [`docs/architecture.md`](architecture.md).

## 4. Tracking IPC save calls (browser tests)

In the init script, expose an array, then push from the relevant handler:

```typescript
(window as Record<string, unknown>).__SAVE_CALLS__ = [];

// inside the save_review_comments handler:
((window as Record<string, unknown>).__SAVE_CALLS__ as unknown[]).push(args);
```

Read back from the test:

```typescript
const calls = await page.evaluate(() =>
  (window as Record<string, unknown>).__SAVE_CALLS__
);
```

## 5. Native E2E pattern

Use the `nativePage` fixture from `./fixtures` — connects to the real binary via CDP (WebView2 on Windows) and auto-skips on non-Windows:

```typescript
import { test, expect } from "./fixtures";

test("...", async ({ nativePage }) => {
  // nativePage is a Playwright Page connected to the real binary via CDP
  // auto-skips on non-Windows -- no IPC mock, real file I/O and OS events
  await expect(nativePage.locator(".welcome-view")).toBeVisible({ timeout: 10_000 });
});
```

Build the debug binary first:

```
cd src-tauri && cargo build
# or
npm run test:e2e:native:build
```

Native specs MUST start with the rule-13 comment justifying why the scenario cannot be a browser test, and MUST NOT duplicate browser-spec assertions (rule 14).

## 6. Canonical DOM selectors

Stable selectors used across browser and native specs. Add to this list when introducing a new top-level region.

| Selector | Component |
|---|---|
| `.app-layout` | Root app container |
| `.welcome-view` | Empty state when no file is open |
| `.folder-tree` | Left sidebar file tree |
| `.folder-tree-filter` | Search input in sidebar |
| `.tab-bar .tab` | Individual open-file tabs |
| `.markdown-viewer` | Rendered markdown |
| `.source-view` | Syntax-highlighted source |
| `.comments-panel` | Right comments sidebar |

## 7. Time, debounce, and watcher tests

For deterministic timing tests:

- Use `vi.useFakeTimers()` plus `vi.setSystemTime()` (rule 19 in `docs/test-strategy.md`).
- Canonical debounce windows: rule 5 in [`docs/performance.md`](performance.md) (file watcher), rule 6 (ghost-entry rescan).
- Assert: event ignored *inside* the window, processed *outside*.

## 8. Common reliability anti-patterns

Each of these is a BLOCK by `test-expert`:

- `waitForTimeout(N)` with a non-symbolic `N` -- replace with `waitFor(condition)` or `expect.poll`.
- Tests that depend on within-file execution order (`beforeAll` mutable state without `beforeEach` reset) -- rule 17.
- Listeners established in tests without an `unlisten()` in teardown.
- Re-using `vi.mocked(invoke)` without `mockReset()` in `beforeEach` -- rule 12.
- `console.error` / `console.warn` triggered intentionally without an in-body `mockImplementation(() => {})` -- rule 15.
- Fixture files mutated by a test, even transiently -- rule 21.
