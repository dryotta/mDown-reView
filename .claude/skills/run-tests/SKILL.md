---
name: run-tests
description: Pick the right mdownreview test suite for the change and run it.
---

Run in this order, stop on first failure:

| Change scope | Command |
|---|---|
| any `src/` or `e2e/` TS | `npm run lint` |
| `src/` logic | `npm test` |
| `e2e/browser/` or UI flow | `npm run test:e2e` |
| `src-tauri/`, watcher, file I/O | `npm run test:e2e:native:build` (Windows-only; CDP not available in CI) |

Report: pass count · fail count · full output of any failures.
