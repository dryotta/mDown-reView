# Observability

Internal runtime instrumentation for the mdownreview Tauri shell. This document is the canonical home for the on-disk log schema produced by the `[ipc]` and `[startup]` event surfaces shipped in issue #264 (PR3 of the engineering-excellence plan). All instrumentation is **internal-only** — end-user behavior is unchanged. Output flows into the rotating log file already managed by `tauri-plugin-log` (see [`docs/features/logging.md`](features/logging.md) and [`docs/architecture.md`](architecture.md) rule 6).

## On-disk schemas

Two stable line schemas, both emitted via `log::info!`/`log::warn!` against named `target` strings so log analyzers can filter cheaply.

### `[ipc]` schema

```
[ipc] cmd=<command_name> duration_us=<u> payload_bytes=<n> ok=<bool>
```

On error:

```
[ipc] cmd=<command_name> duration_us=<u> payload_bytes=<n> ok=false err=<sanitized>
```

**Gating, split by log level:**

| Level | Lines | When emitted |
|---|---|---|
| `warn` | `ok=false err=…` (the error variant) | **Always.** IPC errors are rare and high-value diagnostics; the format + plugin-write cost is negligible on a path that fires only on failure. The err= field is sanitized (control-char strip + 512-char bound) so log-injection / forensic-tampering is blocked. |
| `info` | `ok=true` (every successful call) | Only when `cfg!(debug_assertions) || env::var("MDR_IPC_TRACE").is_ok()`. The success path is the IPC hot path — `search_in_document`, watcher callbacks, etc. fire thousands of times per session. The flag is read once per process and cached in a `OnceLock<bool>`; steady-state cost in a release build with the env var unset is one relaxed atomic load + one branch, well under the hot-path budget in [`docs/performance.md`](performance.md). |

To enable per-success tracing in a release build, set `MDR_IPC_TRACE=1` before launch (see "Enabling extra trace detail" below). Errors and warnings always reach the rotating log file regardless of the env var or build profile.

Field reference:

| Field | Source | Notes |
|---|---|---|
| `cmd` | function name | Stable Rust ident; matches the IPC name on the wire after Tauri's snake_case conversion. |
| `duration_us` | `std::time::Instant` | End-to-end wall time from wrapper entry to body completion, in microseconds. Includes await suspensions for async commands. The `record_first_ipc` atomic and the trace-gate atomic load are *inside* this window; the log-emit cost is *not*. |
| `payload_bytes` | input args | **Iter-1 placeholder — always `0`.** Reserved schema slot so analyzers can pin field order; a future iteration may compute the JSON payload size at the dispatcher boundary. |
| `ok` | `Result::is_ok()` | `true` for non-`Result` returns; otherwise reflects the discriminant. Errors are emitted at `log::warn!` level. |
| `err` (error variant only) | `format!("{:?}", e)`, sanitized | The Debug form of the error (so typed errors `ConfigError`, `SystemError`, … work without implementing `Display`). The string is passed through `startup_recorder::sanitize_err_for_log`: control characters (newlines, carriage returns, ANSI/CSI escapes) are replaced with `?`, and the result is bounded at 512 chars (truncated payloads end with `…(truncated)`). This blocks log-line forgery via attacker-influenced error messages. |

`target` is `"ipc"` for every line.

### `[startup]` schema

```
[startup] phase=<kebab-case-name> t_ms=<n>
```

Each phase fires **at most once per process**. A duplicate call against the same phase emits a `log::debug!` "duplicate, ignored" line (target `"startup"`) and is otherwise a no-op.

| Phase | Recorded by | When |
|---|---|---|
| `app-init` | `lib.rs::run` first instruction | Process anchor — `t_ms` is computed against this. |
| `webview-ready` | `setup()` after main window present | Webview is loadable; renderer can boot. |
| `first-ipc` | `#[mdr_command]` macro expansion | Very first IPC entry of any command. |
| `theme-applied` | Frontend `recordStartupPhase("theme-applied")` | Inline pre-React script (PR4) — currently fires from `main.tsx` as a placeholder. |
| `frontend-mounted` | App.tsx mount effect | React's first effect tick. |
| `first-file-loaded` | (frontend, future PR) | First viewer paint completes. |

`t_ms` is milliseconds since the recorder's `Instant` anchor (set on first touch — typically `app-init`). Phase order is **not** enforced; async timing differences mean callers may report out of sequence.

## Source of truth

| Component | File |
|---|---|
| `#[mdr_command]` proc-macro | `src-tauri/mdr-macros/src/lib.rs` |
| Macro re-export | `src-tauri/src/macros/mod.rs` (re-exports `mdr_macros::mdr_command`); crate-root re-export in `src-tauri/src/lib.rs`. |
| `StartupRecorder` (Rust singleton) | `src-tauri/src/startup_recorder.rs` |
| `record_startup_phase` IPC | `src-tauri/src/commands/startup.rs` |
| Frontend wiring | `src/App.tsx` (`frontend-mounted`), `src/main.tsx` (`theme-applied`). |
| Integration test | `src-tauri/tests/observability.rs` |
| TypeScript binding | `src/lib/bindings.ts` (auto-generated `recordStartupPhase` + `StartupPhase` enum) |
| TS façade wrapper | `src/lib/tauri-commands.ts` (`recordStartupPhase`) |

Every existing IPC handler in `src-tauri/src/commands/`, `src-tauri/src/lib.rs`, `src-tauri/src/watcher.rs`, and `src-tauri/src/update.rs` carries `#[mdr_command]`. The single documented exemption is `commands::remote_asset::fetch_remote_asset` — its `tauri::ipc::Response` return type is binary IPC and specta cannot describe it. That command keeps the bare `#[tauri::command]` annotation and is therefore **not traced**; the merge dispatcher in `lib.rs::run` registers it separately.

## Enabling extra trace detail

Set the `MDR_IPC_TRACE` environment variable to any value (e.g. `1`, `true`) before launching the app to enable the per-success `[ipc] … ok=true` info-level lines in a release build. Debug builds (`cargo build` without `--release`) enable the path implicitly via `cfg!(debug_assertions)`.

```bash
# macOS / Linux
MDR_IPC_TRACE=1 mdownreview

# Windows (PowerShell)
$env:MDR_IPC_TRACE=1; mdownreview
```

`MDR_IPC_TRACE` is **dev-time only** — there is no UI affordance to toggle it (Non-Goal: no in-app log viewer). The variable is read once at first IPC dispatch and cached for the rest of the process; live toggling is intentionally unsupported.

The env var **only** controls the success-path info lines. Errors (`[ipc] … ok=false err=…`) and `[startup]` phase events are always-on regardless of build profile or env var.

## Log location

Events flow into the rotating file managed by `tauri-plugin-log`. Retrieve the path at runtime via:

* GUI — Help → About → "Open log file" (rendered from `getLogPath()` in `src/lib/tauri-commands.ts`).
* CLI — `mdownreview-cli log-path` (see [`docs/specs/cli-mdownreview-cli.md`](specs/cli-mdownreview-cli.md)).

The rotation strategy (`5 MB cap, KeepAll`) is configured in `src-tauri/src/lib.rs::run`. There is no in-app log viewer and no network upload — both are Non-Goals in [`docs/principles.md`](principles.md).

## Post-hoc analysis

A future PR (PR4 of the engineering-excellence plan) will ship `analyze-log` — the canonical command-line consumer for these schemas. It parses the rotating log file and emits aggregate startup timings + per-command IPC distribution histograms. Until that PR lands, ad-hoc `grep "^\[ipc\]"` / `grep "^\[startup\]"` against the rotating file is the supported analysis path.

## Performance budget

In a release build with `MDR_IPC_TRACE` unset, the per-IPC steady-state cost of the `#[mdr_command]` wrapper on the **success path** is:

* one `Instant::now()` (the duration anchor — cheap on modern Windows / macOS),
* one relaxed atomic load to short-circuit `record_first_ipc` post-first-call,
* one relaxed atomic load + branch to short-circuit the `ipc_trace_enabled()` info-line gate (no log emit, no allocation, no plugin write).

On the **error path** the wrapper additionally pays one `log::warn!` invocation: format-args expansion, the sanitizer pass over the Debug-formatted error (bounded at 512 chars), and the plugin dispatch to the rotating log file. Errors are rare relative to successes, so this is unconditional — production diagnostics are valuable enough to justify the always-on cost on a path that fires only on failure.

The `[ipc]` info-level call itself is paid only when the trace gate is open (debug builds, or release with `MDR_IPC_TRACE=1`). This keeps the IPC hot path within the budget tracked in [`docs/performance.md`](performance.md) for commands that fire at keystroke rate (`search_in_document`, `compute_anchor_hash`, watcher callbacks).

`[startup]` events run at most ~6 times per process; their always-on budget is ~3 µs total, well below the 5 ms instrumentation overhead target from #264's acceptance criteria.

Compiled binary growth is bounded by the proc-macro expansion (a single static string per command + a few stack locals + the warn-arm sanitize call + the gated info-arm log site), measured at well under the 100 kB target.

## Related rules

* Single logging chokepoint — rule 6 in [`docs/architecture.md`](architecture.md). The `target: "ipc"` / `target: "startup"` strings are the canonical schema discriminants; analyzers MUST filter on target rather than substring-matching the prefix.
* No telemetry, no in-app log viewer — Non-Goals in [`docs/principles.md`](principles.md).
* Rust-First with MVVM — frontend instrumentation is a one-line `recordStartupPhase` call; the recording, deduplication, and emission live in Rust.
