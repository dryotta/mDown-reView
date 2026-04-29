//! IPC entry point for frontend-driven startup-phase telemetry.
//!
//! The Rust side records `AppInit`, `WebviewReady`, and `FirstIpc`
//! directly (see `lib.rs::run` and the `#[mdr_command]` macro). The
//! frontend reports the remaining phases — `ThemeApplied`,
//! `FrontendMounted`, `FirstFileLoaded` — via this single IPC. The
//! emitted `[startup] phase=… t_ms=…` event flows into the same
//! rotating log file as the rest of the tracing surface (see
//! `docs/observability.md`).
//!
//! Idempotent at the recorder level — the underlying
//! `StartupRecorder::record_phase` dedupes per-phase per-process so
//! a chatty frontend (StrictMode double-invoke, hot reload, etc.)
//! cannot inflate the timeline.

use crate::mdr_command;
use crate::startup_recorder::{record_phase, StartupPhase};

/// Record a startup phase from the frontend. Mirrors
/// `StartupPhase` 1:1 — see that enum for the kebab-case wire shape
/// (`"theme-applied"`, `"frontend-mounted"`, `"first-file-loaded"`).
#[mdr_command]
pub fn record_startup_phase(phase: StartupPhase) {
    record_phase(phase);
}
