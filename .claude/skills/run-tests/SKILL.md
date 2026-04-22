---
name: run-tests
description: Run the appropriate mdownreview test suite based on what changed. Selects between lint, vitest unit tests, browser e2e, or native e2e.
---

Run the correct test suite for mdownreview based on what changed:

- **Lint** (any `src/` or `e2e/` TypeScript changes): `npm run lint`
- **Unit tests** (`src/` changes, store/hook/utility logic): `npm test`
- **Browser E2E** (`e2e/browser/` changes, component UI flows): `npm run test:e2e`
- **Native E2E** (`src-tauri/`, watcher, file I/O — needs built binary): `npm run test:e2e:native:build`

Always run `npm run lint` first (fastest). Then `npm test`, then `npm run test:e2e` if UI-facing.

## Native E2E — local only

Native E2E tests require a real desktop environment with WebView2 and CDP. **They cannot run in GitHub Actions** (CDP port never becomes ready on headless runners).

Run them locally on Windows before any release:

```bash
cd src-tauri && cargo build   # build debug binary
cd .. && npm run test:e2e:native
```

Or use the combined command: `npm run test:e2e:native:build`

The `publish-release` skill enforces this as a local gate before pushing.

Report: pass count, fail count, full output of any failures.
