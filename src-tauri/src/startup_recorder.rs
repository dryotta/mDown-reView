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

/// Process-global gate for the per-call `[ipc]` info line emitted by
/// `#[mdr_command]`. Read by every IPC call (success arm); set once at
/// boot from the precedence chain (`--trace` flag > `MDR_IPC_TRACE` env
/// var > `cfg!(debug_assertions)`) — see `lib.rs::run`.
///
/// Initial value is `cfg!(debug_assertions)` so that:
///   * debug builds (incl. `cargo test`) light up tracing without
///     explicit setup — the macro's behavior is identical to a
///     production build that passed `--trace` on the command line;
///   * release builds default OFF and only flip ON if `lib.rs::run`'s
///     precedence chain says so. There is a brief window between
///     `static` init and the first `set_ipc_trace_enabled` call when
///     this default is observable, but no IPC fires before
///     `tauri::Builder::build()` returns, and the boot sets the gate
///     before the runtime starts dispatching commands.
///
/// The hot-path read is one `Ordering::Relaxed` atomic load — well under
/// the budget in `docs/performance.md` for keystroke-rate commands.
static IPC_TRACE_ENABLED: AtomicBool = AtomicBool::new(cfg!(debug_assertions));

/// Returns whether the per-call `[ipc] … ok=true` info line should be
/// emitted on this IPC dispatch. Always-on warn-level err lines and
/// `[startup]` events are unaffected.
///
/// The flag is set once at boot via [`set_ipc_trace_enabled`]; subsequent
/// calls just observe the atomic. If you want to live-toggle from a
/// running app (e.g. via a Settings IPC), call [`set_ipc_trace_enabled`]
/// from that command — every IPC dispatched after the store sees the new
/// value via the relaxed-acquire ordering used here, which is sufficient
/// because the gate is purely advisory (incorrect for at most a handful
/// of in-flight IPCs while the store propagates).
pub fn ipc_trace_enabled() -> bool {
    IPC_TRACE_ENABLED.load(Ordering::Relaxed)
}

/// Set the [`ipc_trace_enabled`] gate. Called from `lib.rs::run` after
/// applying the `--trace` / `MDR_IPC_TRACE` / `cfg!(debug_assertions)`
/// precedence chain. Safe to call from any thread; uses relaxed ordering
/// (the gate is advisory — see [`ipc_trace_enabled`]).
pub fn set_ipc_trace_enabled(on: bool) {
    IPC_TRACE_ENABLED.store(on, Ordering::Relaxed);
}

/// Maximum length of a sanitized err string in an `[ipc]` log line. Keeps
/// pathological error payloads (e.g. multi-MB serde dumps) from blowing
/// out the rotating log file on a single failed IPC call.
const MAX_LOG_ERR_LEN: usize = 512;

/// Sanitize a Debug-formatted error payload for inclusion in an `[ipc]`
/// log line. Strips control characters that an attacker could use to
/// forge log entries — newlines, carriage returns, and ANSI/CSI escape
/// sequences — and bounds the length so a pathological error cannot
/// rotate out useful diagnostic context.
///
/// The replacement character is `?` (0x3F), which is structurally
/// distinguishable from real text and survives a UTF-8 round trip.
/// Truncation appends `…(truncated)` so a downstream parser can detect
/// the cut and avoid acting on a partial payload.
///
/// Used by the `#[mdr_command]` proc-macro's err= field (see
/// `mdr-macros/src/lib.rs`). Not a security boundary on its own — the
/// `[ipc]` lines are gated behind `ipc_trace_enabled()` and only fire
/// in debug builds or when `MDR_IPC_TRACE=1` — but it closes the
/// log-injection / forensic-tampering surface flagged in the security
/// review of issue #264.
pub fn sanitize_err_for_log(s: &str) -> String {
    let mut out = String::with_capacity(s.len().min(MAX_LOG_ERR_LEN + 16));
    let mut written = 0usize;
    for c in s.chars() {
        if written >= MAX_LOG_ERR_LEN {
            out.push_str("…(truncated)");
            return out;
        }
        // Control characters (C0 + DEL + C1) and ESC are replaced. Keeps
        // ASCII printable, normal whitespace becomes a single space, and
        // anything else (e.g. non-Latin path components) passes through
        // unchanged so the log remains useful for diagnostics.
        let safe = match c {
            '\t' | ' ' => ' ',
            c if c.is_control() => '?',
            c => c,
        };
        out.push(safe);
        written += 1;
    }
    out
}

#[cfg(test)]
mod sanitize_tests {
    use super::sanitize_err_for_log;

    #[test]
    fn strips_newline_carriage_return_and_escape() {
        let payload = "evil\n[ipc] cmd=install_update ok=true\rinjected\x1b[31m";
        let out = sanitize_err_for_log(payload);
        assert!(!out.contains('\n'), "newline must be stripped: {out:?}");
        assert!(!out.contains('\r'), "CR must be stripped: {out:?}");
        assert!(!out.contains('\x1b'), "ESC must be stripped: {out:?}");
    }

    #[test]
    fn preserves_normal_diagnostic_text() {
        let payload = "ConfigError::IoError { path: \"/Users/dev/x.md\", reason: \"ENOENT\" }";
        let out = sanitize_err_for_log(payload);
        assert_eq!(out, payload, "normal text must round-trip unchanged");
    }

    #[test]
    fn truncates_pathological_input() {
        let payload = "a".repeat(2048);
        let out = sanitize_err_for_log(&payload);
        assert!(
            out.ends_with("…(truncated)"),
            "must signal truncation: {out:?}"
        );
        assert!(
            out.chars().count() <= super::MAX_LOG_ERR_LEN + "…(truncated)".chars().count(),
            "must bound output length: got {} chars",
            out.chars().count()
        );
    }
}

/// Test-only access to the recorder's internal `seen` set. Used by the
/// recorder/race tests below to assert the first-call-wins contract.
#[cfg(test)]
pub(crate) fn seen_phases_for_tests() -> HashSet<StartupPhase> {
    state().lock().unwrap_or_else(|p| p.into_inner()).seen.clone()
}

/// Test-only reset hook. Required because `STATE` is process-global —
/// without this, dedup behaviour from one test pollutes the next when
/// `cargo test` runs them in the same process.
#[cfg(test)]
pub(crate) fn reset_for_tests() {
    let mut st = state().lock().unwrap_or_else(|p| p.into_inner());
    st.start = Instant::now();
    st.seen.clear();
    FIRST_IPC_DONE.store(false, Ordering::Relaxed);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;
    use std::thread;

    // `STATE` is a process-global `OnceLock<Mutex<...>>`; tests that
    // mutate it must serialize. `cargo test` runs tests in parallel by
    // default and would otherwise observe each other's `seen` set.
    static SERIAL: Mutex<()> = Mutex::new(());

    /// `as_str` is the schema contract — every phase name is kebab-case
    /// and stable for log analyzers. Adding a new variant requires
    /// extending this match.
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

    /// First call inserts; subsequent calls against the same phase are
    /// silently deduplicated. Pins the "first observation wins" contract
    /// the cold-startup bench depends on.
    #[test]
    fn record_phase_dedupes_repeated_calls() {
        let _g = SERIAL.lock().unwrap();
        reset_for_tests();
        record_phase(StartupPhase::AppInit);
        record_phase(StartupPhase::AppInit);
        record_phase(StartupPhase::AppInit);
        let seen = seen_phases_for_tests();
        assert!(seen.contains(&StartupPhase::AppInit));
        // Each unique variant counted once regardless of how many times
        // `record_phase` was called.
        assert_eq!(seen.len(), 1);
    }

    /// Distinct phases all land in the `seen` set. Distinguishes the
    /// dedup behaviour from accidental "only ever record one phase".
    #[test]
    fn record_phase_keeps_distinct_phases() {
        let _g = SERIAL.lock().unwrap();
        reset_for_tests();
        record_phase(StartupPhase::AppInit);
        record_phase(StartupPhase::WebviewReady);
        record_phase(StartupPhase::FrontendMounted);
        let seen = seen_phases_for_tests();
        assert_eq!(seen.len(), 3);
        assert!(seen.contains(&StartupPhase::AppInit));
        assert!(seen.contains(&StartupPhase::WebviewReady));
        assert!(seen.contains(&StartupPhase::FrontendMounted));
    }

    /// `record_first_ipc` flips the `FIRST_IPC_DONE` atomic and records
    /// `FirstIpc` exactly once even under contention from many threads.
    /// Without the CAS guard, every losing thread would also enter
    /// `record_phase`, holding the recorder mutex on the IPC hot path.
    #[test]
    fn record_first_ipc_runs_once_under_contention() {
        let _g = SERIAL.lock().unwrap();
        reset_for_tests();

        let handles: Vec<_> = (0..32)
            .map(|_| thread::spawn(record_first_ipc))
            .collect();
        for h in handles {
            h.join().unwrap();
        }

        assert!(FIRST_IPC_DONE.load(Ordering::Relaxed));
        let seen = seen_phases_for_tests();
        assert!(seen.contains(&StartupPhase::FirstIpc));
        // Only the FirstIpc phase should be recorded; the recorder must
        // not have side-effected any other phase under the race.
        assert_eq!(seen.len(), 1);
    }

    /// After the first call has flipped the atomic, subsequent calls are
    /// no-ops — the relaxed-load fast path. This is the hot-path
    /// guarantee `mdr_command!` relies on.
    #[test]
    fn record_first_ipc_is_idempotent_after_first_call() {
        let _g = SERIAL.lock().unwrap();
        reset_for_tests();

        record_first_ipc();
        // Manually clear seen but leave FIRST_IPC_DONE set — second
        // call must short-circuit on the relaxed-load and NOT re-enter
        // `record_phase(FirstIpc)`.
        state().lock().unwrap().seen.clear();
        record_first_ipc();
        let seen = seen_phases_for_tests();
        assert!(seen.is_empty(), "second record_first_ipc must short-circuit");
    }
}
