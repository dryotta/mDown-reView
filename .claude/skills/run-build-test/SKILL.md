---
name: run-build-test
description: Use before declaring work complete, before opening a PR, after rebasing, or whenever the user says "run the tests", "run the build", "verify it works locally", or "make sure CI will pass". Runs every build, lint, and test gate that can run on this machine.
---

# run-build-test

Run every local quality gate that mirrors CI, in cheap-to-expensive order. Stop on first failure and surface the full failure output. Skip the gates that cannot run on this OS — never silently invent passes.

## Order

| # | Gate | Command | Skip when |
|---|---|---|---|
| 1 | Frontend lint | `npm run lint` | — |
| 2 | Frontend build (tsc + vite) | `npm run build` | — |
| 3 | Rust format check | `cargo fmt --all --manifest-path src-tauri/Cargo.toml -- --check` | `cargo` not on PATH |
| 4 | Rust clippy | `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` | `cargo` not on PATH |
| 5 | Stage CLI binary (prereq for 6 + 9) | `npm run stage:cli` | — |
| 6 | Rust tests | `cargo test --manifest-path src-tauri/Cargo.toml` | `cargo` not on PATH |
| 7 | Vitest unit + component | `npm test` | — |
| 8 | Playwright browser E2E | `npm run test:e2e` | First run needs `npx playwright install chromium` — install if missing, then retry |
| 9 | Native E2E (Tauri + CDP) | `npm run test:e2e:native:build` | Not Windows |

Gate 5 must succeed before 6 and 9 — `cargo test` and the native E2E both load the staged CLI binary via Tauri `externalBin`.

## Reporting

After every run print one line per gate:
```
[1/9] lint              ✓ 0 errors
[2/9] build             ✓ tsc + vite ok
[3/9] cargo fmt         ✓
...
[9/9] native e2e        SKIPPED (not Windows)
```
On failure: stop the run, print the gate's full stderr/stdout (no truncation), and exit. Do not continue to later gates — they are usually meaningless once an earlier one fails.

End with a summary: `passed=N failed=M skipped=K · elapsed=Xs`.

## Triage hints

- Gate 1 fails → `npm run lint -- --fix` may auto-fix; re-run.
- Gate 2 fails on a `TS####` error → it's tsc, not vite; fix the type and re-run.
- Gate 4 fails on a previously-clean file → likely a new clippy lint; fix don't `#[allow]`.
- Gate 6 fails with `externalBin` / missing `mdownreview-cli` → gate 5 silently failed; re-run gate 5 standalone.
- Gate 8 fails with "browser was not installed" → run `npx playwright install chromium` once and retry the gate.
- Gate 9 fails with port 9222 in use → another Tauri instance is running; close it and retry.

## When to invoke a narrower scope

Use the full sequence when finishing work or before a PR. For tight inner-loop iterations, you may run a single gate by name (e.g. `cargo test` after a Rust-only change) — but always come back and run the full sequence before declaring done.
