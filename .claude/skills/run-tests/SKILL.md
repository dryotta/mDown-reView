---
name: run-tests
description: Run the appropriate mdownreview test suite based on what changed. Selects between vitest unit tests, browser e2e, or native e2e.
---

Run the correct test suite for mdownreview based on what changed:

- **Unit tests** (`src/` changes, store/hook/utility logic): `npm test`
- **Browser E2E** (`e2e/browser/` changes, component UI flows): `npm run test:e2e`
- **Native E2E** (`src-tauri/`, watcher, file I/O — needs built binary): `npm run test:e2e:native:build`

If unsure, run `npm test` first (fastest), then `npm run test:e2e` if UI-facing.
Never run `test:e2e:native` without building first — the binary must exist at `src-tauri/target/debug/mdownreview[.exe]`.

Report: pass count, fail count, full output of any failures.
