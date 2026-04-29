//! Process-singleton emitter for startup-phase telemetry.
//!
//! Used by:
//!   * `lib.rs::run` — records `AppInit` and `WebviewReady`.
//!   * The `mdr_command!` proc-macro expansion — drives the
//!     `FirstIpc` phase via [`record_first_ipc`].
//!   * The `record_startup_phase` IPC — the frontend reports
//!     `ThemeApplied`, `FrontendMounted`, `FirstFileLoaded`.
//!
//! The recorder is process-global (one `OnceLock<Mutex<State>>`).
//! Each phase fires at most once per process; subsequent calls
//! against the same phase emit a debug-level note and otherwise
//! noop. The `[startup]` schema is `phase=<kebab-name> t_ms=<n>`,
//! emitted via `log::info!` so it lands in the rotating log file
//! configured by `tauri-plugin-log` (see `lib.rs::run`).
//!
//! See `docs/observability.md` for the post-hoc analysis pipeline.

use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::Instant;

use serde::{Deserialize, Serialize};

/// Ordered phases of app startup, mirrored to TypeScript via specta as a
/// kebab-case string union (`"app-init" | "webview-ready" | ...`). Each
/// phase is recorded at most once per process lifetime.
///
/// Order of expected emission:
///   1. `AppInit` — Rust `pub fn run` first instruction.
///   2. `WebviewReady` — main webview's `Created` window event.
///   3. `FirstIpc` — first call through any `#[mdr_command]` IPC.
///   4. `ThemeApplied` — frontend reports after applying initial theme
///      (PR4 will move this to a pre-React script tag).
///   5. `FrontendMounted` — React's `App` finished its first effect.
///   6. `FirstFileLoaded` — the user's first viewer paint completes.
///
/// Phase order is not enforced — async timing differences mean the recorder
/// must accept events in any sequence.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "kebab-case")]
pub enum StartupPhase {
    AppInit,
    WebviewReady,
    FirstIpc,
    ThemeApplied,
    FrontendMounted,
    FirstFileLoaded,
}

impl StartupPhase {
    /// Stable kebab-case string used by both the `[startup]` log schema
    /// and the on-wire IPC payload (matched by the `serde(rename_all =
    /// "kebab-case")` above).
    fn as_str(&self) -> &'static str {
        match self {
            StartupPhase::AppInit => "app-init",
            StartupPhase::WebviewReady => "webview-ready",
            StartupPhase::FirstIpc => "first-ipc",
            StartupPhase::ThemeApplied => "theme-applied",
            StartupPhase::FrontendMounted => "frontend-mounted",
            StartupPhase::FirstFileLoaded => "first-file-loaded",
        }
    }
}

struct State {
    /// Wall-clock anchor against which every phase's `t_ms` is computed.
    /// Set the first time the recorder is touched (`AppInit` or earlier).
    start: Instant,
    /// Phases already emitted. Subsequent calls against any phase in this
    /// set are deduplicated (debug-logged but not re-emitted).
    seen: HashSet<StartupPhase>,
}

static STATE: OnceLock<Mutex<State>> = OnceLock::new();

/// Fast-path guard for the `FirstIpc` phase. The proc-macro `#[mdr_command]`
/// fires `record_first_ipc()` on every IPC entry; without this atomic
/// short-circuit every call would acquire the recorder's `Mutex<State>`,
/// imposing a global lock on the entire IPC dispatcher. After the first
/// IPC the atomic flips and subsequent calls return immediately with a
/// single relaxed atomic load.
static FIRST_IPC_DONE: AtomicBool = AtomicBool::new(false);

fn state() -> &'static Mutex<State> {
    STATE.get_or_init(|| {
        Mutex::new(State {
            start: Instant::now(),
            seen: HashSet::new(),
        })
    })
}

/// Record a startup phase. Idempotent — first call wins; subsequent calls
/// against the same phase emit only a debug-level note. Recoverable on
/// `Mutex` poisoning (logs the panic source's data; never panics itself).
pub fn record_phase(phase: StartupPhase) {
    let mut st = match state().lock() {
        Ok(s) => s,
        // Poison recovery: another thread panicked while holding the lock.
        // The `seen` set is still consistent enough to dedupe on, so we
        // unwrap the inner state and proceed.
        Err(p) => p.into_inner(),
    };
    if st.seen.insert(phase) {
        let t_ms = st.start.elapsed().as_millis();
        log::info!(
            target: "startup",
            "[startup] phase={} t_ms={}",
            phase.as_str(),
            t_ms
        );
    } else {
        log::debug!(
            target: "startup",
            "[startup] phase={} (duplicate, ignored)",
            phase.as_str()
        );
    }
}

/// Fast-path entry for the `[mdr_command]` macro: record `FirstIpc`
/// at most once per process. Implemented as an atomic CAS-then-record
/// so the IPC hot path costs one relaxed atomic load after the first
/// invocation. Calls `record_phase(StartupPhase::FirstIpc)` exactly once.
pub fn record_first_ipc() {
    if FIRST_IPC_DONE.load(Ordering::Relaxed) {
        return;
    }
    // CAS to ensure only one thread drives the underlying record_phase.
    // Subsequent threads that lose the race observe the flipped flag
    // on their next call and short-circuit on the relaxed load above.
    if FIRST_IPC_DONE
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Relaxed)
        .is_ok()
    {
        record_phase(StartupPhase::FirstIpc);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `as_str` is the schema contract — every phase name is kebab-case
    /// and stable for log analyzers (PR4's `analyze-log`). Adding a new
    /// variant requires extending this match.
    #[test]
    fn as_str_uses_kebab_case() {
        assert_eq!(StartupPhase::AppInit.as_str(), "app-init");
        assert_eq!(StartupPhase::WebviewReady.as_str(), "webview-ready");
        assert_eq!(StartupPhase::FirstIpc.as_str(), "first-ipc");
        assert_eq!(StartupPhase::ThemeApplied.as_str(), "theme-applied");
        assert_eq!(StartupPhase::FrontendMounted.as_str(), "frontend-mounted");
        assert_eq!(StartupPhase::FirstFileLoaded.as_str(), "first-file-loaded");
    }

    /// JSON wire shape: matches the `serde(rename_all = "kebab-case")`
    /// attribute. The frontend's `bindings.ts` consumes the same string
    /// values; this guards against an accidental rename diverging the
    /// wire contract.
    #[test]
    fn serde_emits_kebab_case() {
        let s = serde_json::to_string(&StartupPhase::FrontendMounted).unwrap();
        assert_eq!(s, "\"frontend-mounted\"");
    }
}
