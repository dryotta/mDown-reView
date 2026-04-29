//! Issue #264 — runtime tracing infrastructure: observability integration test.
//!
//! Asserts:
//! 1. Calling `record_phase` for a fresh phase emits `[startup] phase=… t_ms=…`
//!    at INFO level.
//! 2. Calling `record_phase` again for the same phase does NOT re-emit at
//!    INFO — it logs at DEBUG ("duplicate, ignored") instead.
//! 3. The `[ipc] cmd=… duration_us=… payload_bytes=… ok=…` schema fires
//!    once per call to a `#[mdr_command]`-wrapped function with the
//!    expected ok-state.
//! 4. The `MDR_IPC_TRACE=1` env var path does not panic and emits the
//!    same canonical schema (the env-var only affects the
//!    `payload_bytes` field gating; both branches currently emit `0`,
//!    documented as the iter-1 placeholder in `docs/observability.md`).
//!
//! The test installs an in-memory `log::Log` and serializes the assertion
//! across the whole binary via a `Mutex` because `log::set_logger`
//! is process-global (and `cargo test` shares one binary per
//! test target). The mutex also serialises `MDR_IPC_TRACE` env-var
//! mutation against any other test that might read the same var.

use mdown_review_lib::mdr_command;
use mdown_review_lib::startup_recorder::{record_first_ipc, record_phase, StartupPhase};
use std::sync::{Mutex, OnceLock};

// ── In-memory log capture ────────────────────────────────────────────────

/// Captured log line: (target, level, message). Targets we care about are
/// `"ipc"` and `"startup"` — the macro / recorder canonical surfaces.
#[derive(Debug, Clone)]
struct LogLine {
    target: String,
    level: log::Level,
    message: String,
}

struct CaptureLogger;

static CAPTURED: OnceLock<Mutex<Vec<LogLine>>> = OnceLock::new();

fn captured() -> &'static Mutex<Vec<LogLine>> {
    CAPTURED.get_or_init(|| Mutex::new(Vec::new()))
}

impl log::Log for CaptureLogger {
    fn enabled(&self, _meta: &log::Metadata) -> bool {
        true
    }

    fn log(&self, record: &log::Record) {
        let line = LogLine {
            target: record.target().to_string(),
            level: record.level(),
            message: format!("{}", record.args()),
        };
        if let Ok(mut g) = captured().lock() {
            g.push(line);
        }
    }

    fn flush(&self) {}
}

static LOGGER: CaptureLogger = CaptureLogger;
static INIT: OnceLock<()> = OnceLock::new();

/// Install the capture logger exactly once. `log::set_logger` panics on a
/// second install per process; `OnceLock` guards us. The integration tests
/// must run in a single binary so we accept that this is a process-wide
/// install and the `cargo test` runner serialises tests inside the same
/// binary's target dir.
fn install_logger() {
    INIT.get_or_init(|| {
        // ignore error if another integration test already installed a
        // logger — we only need OURS to be observed by the assertions
        // below; a parallel test binary running concurrently uses its own
        // process and does not race here.
        let _ = log::set_logger(&LOGGER);
        log::set_max_level(log::LevelFilter::Trace);
    });
}

/// Serialise every test in this file so the shared log buffer + env-var
/// state is observed deterministically. `cargo test` parallelises tests
/// by default; without this lock two `[startup] phase=app-init` lines
/// from independent fixtures could collide and confuse the assertions.
static TEST_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
fn test_lock() -> &'static Mutex<()> {
    TEST_LOCK.get_or_init(|| Mutex::new(()))
}

fn drain_captured() -> Vec<LogLine> {
    let mut g = captured().lock().unwrap_or_else(|p| p.into_inner());
    let out = std::mem::take(&mut *g);
    out
}

// ── Fixture command ──────────────────────────────────────────────────────

/// Stand-in IPC handler used to verify the `[ipc]` schema. `#[mdr_command]`
/// expands to `#[tauri::command] + #[specta::specta] + tracing wrap`. We
/// don't actually go through the Tauri runtime — we just CALL the function
/// like a normal Rust fn and observe the logs the wrap emits.
///
/// Returning `Result<i32, String>` exercises the `ok=true|false` branch
/// of the macro; a sister fixture `fixture_err_command` covers the warn
/// path for typed errors.
#[mdr_command]
fn fixture_ok_command(value: i32) -> Result<i32, String> {
    Ok(value * 2)
}

#[mdr_command]
fn fixture_err_command(reason: String) -> Result<(), String> {
    Err(reason)
}

#[mdr_command]
fn fixture_unit_command(value: i32) -> i32 {
    value + 1
}

// ── Tests ────────────────────────────────────────────────────────────────

#[test]
fn record_phase_emits_startup_schema_once() {
    let _guard = test_lock().lock().unwrap_or_else(|p| p.into_inner());
    install_logger();
    drain_captured();

    // First call — INFO emit expected.
    record_phase(StartupPhase::ThemeApplied);
    let lines = drain_captured();
    let info_lines: Vec<_> = lines
        .iter()
        .filter(|l| l.target == "startup" && l.level == log::Level::Info)
        .collect();
    assert!(
        info_lines
            .iter()
            .any(|l| l.message.starts_with("[startup] phase=theme-applied t_ms=")),
        "first record_phase(ThemeApplied) must emit INFO `[startup] phase=theme-applied t_ms=…`, got {:?}",
        lines
    );

    // Second call — DEBUG emit (deduped); NO INFO.
    record_phase(StartupPhase::ThemeApplied);
    let lines = drain_captured();
    let info_again: Vec<_> = lines
        .iter()
        .filter(|l| {
            l.target == "startup"
                && l.level == log::Level::Info
                && l.message.contains("phase=theme-applied")
        })
        .collect();
    assert!(
        info_again.is_empty(),
        "second record_phase(ThemeApplied) must NOT re-emit at INFO, got {:?}",
        info_again
    );
    let dup_lines: Vec<_> = lines
        .iter()
        .filter(|l| l.target == "startup" && l.message.contains("duplicate, ignored"))
        .collect();
    assert_eq!(
        dup_lines.len(),
        1,
        "second record_phase(ThemeApplied) must emit exactly one DEBUG dedupe note, got {:?}",
        lines
    );
}

#[test]
fn first_ipc_recorded_once_via_record_first_ipc() {
    let _guard = test_lock().lock().unwrap_or_else(|p| p.into_inner());
    install_logger();
    drain_captured();

    // Hammer the function — atomic CAS guard ensures `FirstIpc` fires at
    // most once across the entire process. After the first test in this
    // file runs (any of the fixture_* commands), the flag is already
    // flipped; this is fine because the assertion is "fires AT MOST once,
    // for the whole process". We assert the relaxed-load fast-path
    // behaviour here: subsequent calls do NOT panic and do NOT log.
    for _ in 0..16 {
        record_first_ipc();
    }
    let lines = drain_captured();
    let first_ipc_emits: Vec<_> = lines
        .iter()
        .filter(|l| l.target == "startup" && l.message.contains("phase=first-ipc"))
        .filter(|l| l.level == log::Level::Info)
        .collect();
    assert!(
        first_ipc_emits.len() <= 1,
        "record_first_ipc must emit FirstIpc INFO at most once per process, got {} lines: {:?}",
        first_ipc_emits.len(),
        first_ipc_emits
    );
}

#[test]
fn mdr_command_emits_ipc_schema_on_ok() {
    let _guard = test_lock().lock().unwrap_or_else(|p| p.into_inner());
    install_logger();
    drain_captured();

    let result = fixture_ok_command(21);
    assert_eq!(result, Ok(42));

    let lines = drain_captured();
    let ipc_lines: Vec<_> = lines
        .iter()
        .filter(|l| l.target == "ipc" && l.level == log::Level::Info)
        .collect();
    assert!(
        ipc_lines.iter().any(|l| {
            l.message.starts_with("[ipc] cmd=fixture_ok_command duration_us=")
                && l.message.contains("payload_bytes=0")
                && l.message.contains("ok=true")
        }),
        "fixture_ok_command must emit `[ipc] cmd=… duration_us=… payload_bytes=0 ok=true`, got {:?}",
        ipc_lines
    );
}

#[test]
fn mdr_command_emits_ipc_warn_on_err() {
    let _guard = test_lock().lock().unwrap_or_else(|p| p.into_inner());
    install_logger();
    drain_captured();

    let result = fixture_err_command("disk_full".to_string());
    assert_eq!(result, Err("disk_full".to_string()));

    let lines = drain_captured();
    let ipc_warns: Vec<_> = lines
        .iter()
        .filter(|l| l.target == "ipc" && l.level == log::Level::Warn)
        .collect();
    assert!(
        ipc_warns.iter().any(|l| {
            l.message.starts_with("[ipc] cmd=fixture_err_command duration_us=")
                && l.message.contains("ok=false")
                && l.message.contains("disk_full")
        }),
        "fixture_err_command must emit WARN `[ipc] cmd=… ok=false err=…`, got {:?}",
        ipc_warns
    );
}

#[test]
fn mdr_command_unit_return_logs_ok_true() {
    let _guard = test_lock().lock().unwrap_or_else(|p| p.into_inner());
    install_logger();
    drain_captured();

    let v = fixture_unit_command(7);
    assert_eq!(v, 8);

    let lines = drain_captured();
    let ipc_lines: Vec<_> = lines
        .iter()
        .filter(|l| l.target == "ipc" && l.level == log::Level::Info)
        .collect();
    assert!(
        ipc_lines.iter().any(|l| {
            l.message.starts_with("[ipc] cmd=fixture_unit_command duration_us=")
                && l.message.contains("ok=true")
        }),
        "fixture_unit_command (non-Result return) must log ok=true, got {:?}",
        ipc_lines
    );
}

#[test]
fn mdr_ipc_trace_env_does_not_panic() {
    let _guard = test_lock().lock().unwrap_or_else(|p| p.into_inner());
    install_logger();
    drain_captured();

    // SAFETY: env-var mutation is process-global and racy w.r.t. other
    // threads observing the same var. The test_lock above serialises this
    // with the rest of this file's tests.
    // SAFETY note for set_var: the std::env API is `unsafe` only on
    // newer toolchains; on stable it is safe. This file targets the
    // current edition; if the toolchain bumps to a release that gates
    // env::set_var as unsafe, wrap in `unsafe { … }`.
    std::env::set_var("MDR_IPC_TRACE", "1");
    let result = fixture_ok_command(1);
    assert_eq!(result, Ok(2));
    std::env::remove_var("MDR_IPC_TRACE");

    let lines = drain_captured();
    let ipc_lines: Vec<_> = lines
        .iter()
        .filter(|l| l.target == "ipc" && l.level == log::Level::Info)
        .collect();
    assert!(
        !ipc_lines.is_empty(),
        "MDR_IPC_TRACE=1 path must still emit canonical `[ipc]` schema, got {:?}",
        lines
    );
}
