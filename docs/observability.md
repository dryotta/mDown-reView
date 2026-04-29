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
[ipc] cmd=<command_name> duration_us=<u> payload_bytes=<n> ok=false err=<debug_form>
```

Field reference:

| Field | Source | Notes |
|---|---|---|
| `cmd` | function name | Stable Rust ident; matches the IPC name on the wire after Tauri's snake_case conversion. |
| `duration_us` | `std::time::Instant` | End-to-end wall time from wrapper entry to body completion, in microseconds. Includes await suspensions for async commands. |
| `payload_bytes` | input args | **Iter-1 placeholder — always `0`.** A future iteration may compute via post-processing of the JSON payload at the dispatcher boundary; the schema slot is reserved now so analyzers can pin field order. The `MDR_IPC_TRACE=1` env var (and `cfg(debug_assertions)`) gate the *future* compute path; today both branches emit `0`. |
| `ok` | `Result::is_ok()` | `true` for non-`Result` returns; otherwise reflects the discriminant. Errors are emitted at `log::warn!` level with `err=<Debug>` so typed errors (`ConfigError`, `SystemError`, …) survive without implementing `Display`. |

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

Set the `MDR_IPC_TRACE` environment variable to any value (e.g. `1`, `true`) before launching the app. This gates the *future* `payload_bytes` computation path (today both branches emit `0`). Debug builds (`cargo build` without `--release`) implicitly enable the path via `cfg!(debug_assertions)`.

```bash
# macOS / Linux
MDR_IPC_TRACE=1 mdownreview

# Windows (PowerShell)
$env:MDR_IPC_TRACE=1; mdownreview
```

The `[ipc]` and `[startup]` events are emitted **regardless** of `MDR_IPC_TRACE` — the env var only affects the optional payload sizing.

## Log location

Events flow into the rotating file managed by `tauri-plugin-log`. Retrieve the path at runtime via:

* GUI — Help → About → "Open log file" (rendered from `getLogPath()` in `src/lib/tauri-commands.ts`).
* CLI — `mdownreview-cli log-path` (see [`docs/specs/cli-mdownreview-cli.md`](specs/cli-mdownreview-cli.md)).

The rotation strategy (`5 MB cap, KeepAll`) is configured in `src-tauri/src/lib.rs::run`. There is no in-app log viewer and no network upload — both are Non-Goals in [`docs/principles.md`](principles.md).

## Post-hoc analysis

A future PR (PR4 of the engineering-excellence plan) will ship `analyze-log` — the canonical command-line consumer for these schemas. It parses the rotating log file and emits aggregate startup timings + per-command IPC distribution histograms. Until that PR lands, ad-hoc `grep "^\[ipc\]"` / `grep "^\[startup\]"` against the rotating file is the supported analysis path.

## Performance budget

The `#[mdr_command]` wrapper adds one `Instant::now()` + one atomic load (`record_first_ipc`) + one log call per IPC. On a modern Windows / macOS host this is a low-microsecond overhead per call — well below the 100 µs cold-startup IPC budget tracked in [`docs/performance.md`](performance.md). The compiled binary growth is bounded by the proc-macro expansion (a single static string per command + a few stack locals), measured at well under the 100 kB target documented in #264's acceptance criteria.

## Related rules

* Single logging chokepoint — rule 6 in [`docs/architecture.md`](architecture.md). The `target: "ipc"` / `target: "startup"` strings are the canonical schema discriminants; analyzers MUST filter on target rather than substring-matching the prefix.
* No telemetry, no in-app log viewer — Non-Goals in [`docs/principles.md`](principles.md).
* Rust-First with MVVM — frontend instrumentation is a one-line `recordStartupPhase` call; the recording, deduplication, and emission live in Rust.
