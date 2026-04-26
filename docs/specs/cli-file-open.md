# Behavioral Spec — GUI launch arguments & file-open

> Canonical behaviour of the **GUI** binary's command-line argument handling
> and OS file-open paths (CLI launch, Finder/Explorer single-click,
> multi-select Open, default-handler invocation, single-instance argv
> forwarding). Feature overview lives in
> [`docs/features/cli-and-associations.md`](../features/cli-and-associations.md);
> this spec adds **Given / When / Then** scenarios.
>
> Implementation: `src-tauri/src/commands/launch.rs` (`parse_launch_args`,
> `PendingArgsState`, `get_launch_args`), `src-tauri/src/lib.rs` (setup,
> single-instance callback, `RunEvent::Opened`), `src-tauri/src/core/paths.rs`
> (`resolve_path`), `src/hooks/useLaunchArgsBootstrap.ts`,
> `src/store/index.ts::openFilesFromArgs`,
> `src-tauri/installer/installer-hooks.nsh`.

## Argument grammar

The parser accepts (case-insensitive on Windows path comparisons):

```
mdownreview [--folder <dir>]... [--file <path>]... [<positional>...]
```

- `--folder` and `--file` may appear in any order, before or after positional
  arguments. Parsing is **two-pass**: pass 1 collects every `--folder`, pass
  2 resolves every `--file`/positional with full knowledge of the folder
  list.
- A positional that resolves to a directory becomes a folder; one that
  resolves to a file becomes a file.

## Path-resolution rules

The GUI calls into `core::paths::resolve_path` exactly as the CLI does:

1. Absolute paths bypass `--folder` and `cwd`.
2. Relative paths join `--folder` (the **first** collected folder) when
   present, else `cwd`.
3. Resolution is followed by `canonicalize`. **Non-existent paths are
   silently skipped** (no error UI, no log spam).

## `--folder`-relative resolution

### Scenario: `--folder` before a relative positional

- **Given** the cwd is `/tmp` and `/proj/relative/file.md` exists.
- **When** `mdownreview --folder /proj relative/file.md` is launched.
- **Then** `relative/file.md` resolves to `/proj/relative/file.md` and one
  tab opens for it.
- **Coverage:** `src-tauri/src/commands/launch.rs` parser tests.

### Scenario: `--folder` after a relative positional (order-insensitivity)

- **When** `mdownreview relative/file.md --folder /proj` is launched.
- **Then** the result is identical to the previous scenario — pass 1 sees
  `--folder /proj` regardless of position.

### Scenario: `--folder` + `--file` (relative)

- **When** `mdownreview --folder /proj --file subdir/doc.md`.
- **Then** `subdir/doc.md` resolves under `/proj`.

### Scenario: absolute positional ignores `--folder`

- **When** `mdownreview /abs/path/file.md --folder /proj`.
- **Then** `/abs/path/file.md` is used verbatim; `--folder` does not affect
  it.

### Scenario: bare relative path with no `--folder`

- **When** `mdownreview relative/file.md` (no `--folder`).
- **Then** the path resolves against the process cwd.

### Scenario: GUI parser uses the same resolver as the CLI

- **Given** `core::paths::resolve_path` is the canonical resolver.
- **Then** `parse_launch_args` calls it for every path it produces — no
  ad-hoc joining elsewhere in `lib.rs` or the `launch` commands.

## Multi-file launches & single-instance forwarding

### Scenario: 5 positional files in one command line open 5 tabs

- **Given** five readable `.md` files.
- **When** `mdownreview a.md b.md c.md d.md e.md` is invoked.
- **Then** the parser produces a `LaunchArgs { files: [a..e] }` of length 5;
  all five are pushed into `PendingArgsState`, drained on first `mount`, and
  open as five tabs in input order.

### Scenario: 10 positional files via CLI open 10 tabs (no drops)

- Generalisation of the above. The pending-args queue is unbounded; bounded
  only by user action.

### Scenario: pending-args queue accumulates across producers

- **Given** the queue starts empty and the first instance is still booting.
- **When** the user double-clicks a second `.md` file before the webview
  attaches its `args-received` listener.
- **Then** the single-instance plugin callback **pushes** the parsed args
  onto `PendingArgsState` *first*, then emits the signal-only
  `args-received` event. The signal may be dropped (no listener yet) but
  the args remain queued and are drained by the very first mount-time call
  to `get_launch_args`.

### Scenario: signal-only `args-received` event

- **Given** the frontend listener is attached.
- **When** `args-received` fires (any source).
- **Then** the listener treats the payload as ignored; it calls
  `get_launch_args` to drain whatever is queued.
- **Backstop:** even if a signal is missed, the next mount or the next
  signal will drain.

### Scenario: listener-first ordering on the frontend

- **Given** mount of `useLaunchArgsBootstrap`.
- **Then** `listen("args-received", drain)` is registered **before** the
  first `getLaunchArgs()` call. Any signal that fires between attach and
  the initial drain is captured.

### Scenario: forwarded launches before webview readiness still deliver

- **Given** the user clicks a second `.md` while the webview is still
  initializing.
- **Then** the args are pushed onto the queue regardless of webview state;
  the first `getLaunchArgs()` call after mount returns them merged with any
  startup args.

### Scenario: single-drain dedup

- **Given** two forwarded launches each contain `a.md` (and one also
  contains `b.md`).
- **When** the frontend drains the queue.
- **Then** `get_launch_args` returns `{files:[a, b]}` (queue-level dedup,
  first-seen order); `openFilesFromArgs` further dedupes against the
  existing `tabs[]` so only one new tab opens for `a.md`.

### Scenario: non-existent paths are silently skipped

- **When** `mdownreview real.md does-not-exist.md other.md` is invoked.
- **Then** `real.md` and `other.md` open; `does-not-exist.md` is dropped
  without erroring (matches the documented "non-existent paths still
  silently skipped" behaviour).

## OS shell integration

### Scenario: Windows Explorer single-file open

- **Given** the NSIS installer registered the Open verb (per
  `installer/installer-hooks.nsh`).
- **When** the user double-clicks a `.md` file in Explorer.
- **Then** Windows invokes `…\mdownreview.exe <file>`; the running instance
  (or new instance) opens it as a tab.

### Scenario: Windows Explorer multi-select → Enter (post-install)

- **Given** the NSIS installer registered the Open verb as
  `"$INSTDIR\mdownreview.exe" %*` (the `%*` is critical — `%1` would force
  per-file process spawning).
- **When** the user selects 3 `.md` files, presses Enter.
- **Then** Windows invokes the verb **once** with all three files on one
  command line. `parse_launch_args` produces a 3-element file list and one
  process serves all three tabs.

### Scenario: Windows Explorer multi-select via right-click "Open" (legacy)

- **Given** the right-click "Open" verb forwards files one-per-process on
  some Windows builds.
- **When** the user multi-selects 3 files and right-clicks Open.
- **Then** N processes are spawned; `tauri-plugin-single-instance` forwards
  argv from the late starters into the first instance's
  single-instance-callback. Each callback pushes onto
  `PendingArgsState`. The frontend's signal-driven drains absorb every
  forwarded batch — **no file is dropped**.

### Scenario: macOS Finder "Open With" multi-select

- **Given** the macOS bundle is the registered handler.
- **When** the user multi-selects 3 files in Finder and chooses Open With →
  mdownreview.
- **Then** the runtime delivers `RunEvent::Opened` with a vector of paths;
  the handler pushes them onto `PendingArgsState` and emits
  `args-received`. The frontend drains and opens all three.

### Scenario: macOS Finder open-while-running

- **Given** the app is already running.
- **When** the user opens a `.md` from Finder.
- **Then** `RunEvent::Opened` fires in the running process; same push +
  signal flow opens a tab in the existing window.

## Failure modes (negative scenarios)

### Scenario: `--folder` to a non-existent directory

- **When** `mdownreview --folder /does/not/exist file.md`.
- **Then** `--folder` canonicalize fails; the parser falls back to using
  cwd as the join base for relative paths (or, when cwd join also fails to
  canonicalize, the file is silently skipped).

### Scenario: filesystem race during launch

- **When** a relative file is removed between argv parse and `canonicalize`.
- **Then** the launch silently skips that one file; other files still open.

## Coverage

- **Rust parser tests:** `src-tauri/src/commands/launch.rs::tests`
  (parse_launch_args + queue merge/dedup).
- **Rust path tests:** `src-tauri/src/core/paths.rs::tests`.
- **Browser e2e:** `e2e/browser/cli-open.spec.ts` (signal-only event,
  multi-file drain, queue dedup).
- **Native e2e:** see `docs/test-strategy.md` rule 13 — a real-binary
  scenario for OS shell file-open is permitted under the native-e2e
  exception block.
