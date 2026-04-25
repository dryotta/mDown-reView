# Native E2E tests

These tests drive the real Tauri app on a Windows runner via WebView2 + the
Chrome DevTools Protocol (CDP). They are listed alphabetically and run
serially because they share a single app window (see
`playwright.native.config.ts`).

## Specs

- `01-smoke.spec.ts` — app boots and shows the welcome view.
- `02-ipc-commands.spec.ts` — IPC round-trips work.
- `03-file-reload.spec.ts` — file change re-renders.
- `04-scroll-stability.spec.ts` — scroll position is preserved across re-renders.
- `installer.spec.ts` — **real-installer smoke**. Builds-then-runs the Windows
  NSIS installer to verify per-user `PATH` is added on install and removed
  cleanly on uninstall. Runs on Windows runners only (gated via
  `test.skip(process.platform !== "win32", ...)`). Static `.nsh` syntax checks
  (e.g. grepping for required tokens) are guardrails — see the comments in
  `src-tauri/installer/installer-hooks.nsh` — not a substitute for this spec.
