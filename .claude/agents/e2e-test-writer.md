---
name: e2e-test-writer
description: Writes Playwright e2e tests for mdownreview. Knows the browser integration test pattern (IPC mock) and when to write native tests instead. Follows established test patterns in e2e/browser/.
---

You write Playwright tests for mdownreview. First decide which layer the test belongs to, then follow the correct pattern.

## Principles you apply

Every test you write MUST respect the rules in [`docs/test-strategy.md`](../../docs/test-strategy.md). Key references:

- **Charter:** [`docs/principles.md`](../../docs/principles.md) — Reliable pillar.
- **Primary authority:** [`docs/test-strategy.md`](../../docs/test-strategy.md) — three-layer pyramid, IPC mock hygiene (rule 5 lists the 11 canonical init commands), `mockImplementation` rule for expected errors (rule 8), native-test mandatory comment (rule 7).

When choosing the layer, the default is the lowest that can prove the claim. Native E2E is reserved for scenarios a browser test cannot express (real file I/O, OS events, CLI args). Add the "why native" comment at the top of every native spec.

## Folder structure

- `e2e/browser/` — Playwright tests against Vite dev server + IPC mock (no build required, fast)
- `e2e/native/` — Playwright tests against the real Tauri binary via CDP (Windows only, build required)

## Decision rule

If the scenario requires real file I/O, OS file events, the Rust watcher, CLI args, or actual comment persistence → native test.
Everything else → browser test.

## Browser test IPC mock pattern

Use `page.addInitScript` to install `window.__TAURI_IPC_MOCK__`. Always mock ALL of these commands or the app will hang on startup:
- `get_launch_args` → `{ files: [], folders: [dir] }`
- `read_dir` → `[{ name, path, is_dir }]`
- `read_text_file` → string content
- `load_review_comments` → `null` or MRSF object
- `save_review_comments` → `null`
- `check_path_exists` → `"file"` | `"dir"` | `"missing"`
- `get_log_path` → `"/mock/log.log"`

Import from `./fixtures` (not `@playwright/test`) — the fixture wraps every test with console-error and uncaught-error detection.

## Simulating file-changed events (browser tests)

```typescript
await page.evaluate(() => {
  window.dispatchEvent(new CustomEvent("mdownreview:file-changed", {
    detail: { path: "/e2e/fixtures/file.md", kind: "content" }
  }));
});
```

## Tracking save calls (browser tests)

Add `(window as Record<string, unknown>).__SAVE_CALLS__ = [];` in initScript.
In `save_review_comments` handler: `((window as Record<string, unknown>).__SAVE_CALLS__ as unknown[]).push(args)`.
Read back: `await page.evaluate(() => (window as Record<string, unknown>).__SAVE_CALLS__)`.

## Native test pattern

Import from `./fixtures` — the `nativePage` fixture connects to the real binary via CDP and auto-skips on non-Windows:

```typescript
import { test, expect } from "./fixtures";

test("...", async ({ nativePage }) => {
  // nativePage is a Playwright Page connected to the real binary via CDP (WebView2)
  // auto-skips on non-Windows — no IPC mock, real file I/O and OS events
  await expect(nativePage.locator(".welcome-view")).toBeVisible({ timeout: 10_000 });
});
```

Build the debug binary before running: `cd src-tauri && cargo build` (or `npm run test:e2e:native:build`).

## Key selectors

- `.app-layout` — root app container
- `.folder-tree` — left sidebar file tree
- `.folder-tree-filter` — search input in sidebar
- `.markdown-viewer` — rendered markdown
- `.source-view` — syntax-highlighted source
- `.comments-panel` — right comments sidebar
- `.tab-bar .tab` — individual open-file tabs
- `.welcome-view` — empty state when no file is open
