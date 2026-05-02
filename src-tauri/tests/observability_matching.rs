//! Issue #280 AC4 — `[matching]` log schema. Asserts:
//!
//! * Every line-anchor outcome class emits exactly one structured
//!   `[matching]` event with target `"matching"` and the schema fields
//!   (`cmd`, `file` 8-hex, `comment_id`, `outcome`, `orig_line`,
//!   `matched_line`, `re_derived`).
//! * INFO-level events (`exact-orig`, `exact-relocated`, `plausibility`,
//!   `line-fallback`) are gated on `ipc_trace_enabled()`; off when the
//!   gate is closed, on when the gate is open.
//! * WARN-level events (`exact-ambiguous`, `orphan`, `fuzzy`) fire
//!   regardless of the gate.
//! * `cmd == "get_file_badges"` suppresses the WARN variant (folder-badge
//!   refresh would otherwise spray WARNs across many files per scan).
//!
//! Uses the `log::Log` capture pattern from `tests/observability.rs` and
//! installs the `tracing_log_bridge` so `tracing::warn!` / `tracing::info!`
//! events from the matcher reach the captured logger.

use mdown_review_lib::core::matching::match_comments;
use mdown_review_lib::core::types::MrsfComment;
use mdown_review_lib::startup_recorder::set_ipc_trace_enabled;
use std::sync::{Mutex, OnceLock};

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

fn install() {
    INIT.get_or_init(|| {
        let _ = log::set_logger(&LOGGER);
        log::set_max_level(log::LevelFilter::Trace);
        // Forward `tracing::warn!`/`tracing::info!` events into `log`
        // so the capture above sees them. The bridge no-ops if another
        // global tracing subscriber is already installed.
        mdown_review_lib::tracing_log_bridge::install();
    });
}

static TEST_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
fn test_lock() -> &'static Mutex<()> {
    TEST_LOCK.get_or_init(|| Mutex::new(()))
}

fn drain() -> Vec<LogLine> {
    let mut g = captured().lock().unwrap_or_else(|p| p.into_inner());
    std::mem::take(&mut *g)
}

fn matching_lines(lines: &[LogLine]) -> Vec<&LogLine> {
    lines.iter().filter(|l| l.target == "matching").collect()
}

fn make_comment(id: &str, line: Option<u32>, selected_text: Option<&str>) -> MrsfComment {
    MrsfComment {
        id: id.to_string(),
        author: "test".into(),
        timestamp: "2024-01-01T00:00:00Z".into(),
        text: "x".into(),
        resolved: false,
        line,
        selected_text: selected_text.map(|s| s.to_string()),
        ..Default::default()
    }
}

fn assert_schema(line: &LogLine, expected_outcome: &str, expected_cmd: &str) {
    assert_eq!(line.target, "matching");
    assert!(line.message.contains(&format!("cmd={}", expected_cmd)),
        "missing cmd field, got: {}", line.message);
    assert!(line.message.contains(&format!("outcome={}", expected_outcome)),
        "outcome mismatch, expected {}, got: {}", expected_outcome, line.message);
    // file= field must be exactly 8 hex chars.
    let file_token = line.message
        .split_whitespace()
        .find(|t| t.starts_with("file="))
        .expect("file= field missing");
    let file_value = file_token.trim_start_matches("file=");
    assert_eq!(file_value.len(), 8, "file hash must be 8 hex chars: {}", file_value);
    assert!(file_value.chars().all(|c| c.is_ascii_hexdigit()),
        "file hash must be hex: {}", file_value);
    assert!(line.message.contains("comment_id="),
        "missing comment_id field: {}", line.message);
    assert!(line.message.contains("orig_line="),
        "missing orig_line field: {}", line.message);
    assert!(line.message.contains("orig_end="),
        "missing orig_end field: {}", line.message);
    assert!(line.message.contains("matched_line="),
        "missing matched_line field: {}", line.message);
    assert!(line.message.contains("matched_end="),
        "missing matched_end field: {}", line.message);
    assert!(line.message.contains("re_derived="),
        "missing re_derived field: {}", line.message);
    assert!(line.message.contains("[matching]"),
        "missing [matching] prefix: {}", line.message);
}

#[test]
fn every_outcome_class_emits_matching_schema() {
    let _g = test_lock().lock().unwrap_or_else(|p| p.into_inner());
    install();
    set_ipc_trace_enabled(true);

    // exact-orig: comment.line=2 + selected_text on line 2 → no relocation.
    drain();
    let comments = vec![make_comment("c-orig", Some(2), Some("hello world"))];
    let lines = vec!["x", "hello world", "y"];
    let _ = match_comments(&comments, &lines, "/tmp/a.md", "get_file_comments");
    let evts = drain();
    let m = matching_lines(&evts);
    assert_eq!(m.len(), 1, "exact-orig: expected 1 matching line, got {:?}", evts);
    assert_eq!(m[0].level, log::Level::Info);
    assert_schema(m[0], "exact-orig", "get_file_comments");
    assert!(m[0].message.contains("re_derived=false"));

    // exact-relocated: comment.line=1 + selected_text on line 3 → relocated.
    let comments = vec![make_comment("c-reloc", Some(1), Some("hello world"))];
    let lines = vec!["a", "b", "hello world"];
    let _ = match_comments(&comments, &lines, "/tmp/a.md", "get_file_comments");
    let evts = drain();
    let m = matching_lines(&evts);
    assert_eq!(m.len(), 1);
    assert_eq!(m[0].level, log::Level::Info);
    assert_schema(m[0], "exact-relocated", "get_file_comments");
    assert!(m[0].message.contains("re_derived=true"));
    // Concrete value: original line preserved on the wire so analyzers can
    // surface "originally line 1 → relocated to N".
    assert!(
        m[0].message.contains("orig_line=1"),
        "expected orig_line=1: {}",
        m[0].message
    );

    // exact-ambiguous: line=None + multiple matches → WARN regardless of gate.
    set_ipc_trace_enabled(false);
    let comments = vec![make_comment("c-amb", None, Some("hello"))];
    let lines = vec!["hello world", "x", "hello there"];
    let _ = match_comments(&comments, &lines, "/tmp/a.md", "get_file_comments");
    let evts = drain();
    let m = matching_lines(&evts);
    assert_eq!(m.len(), 1, "exact-ambiguous must WARN even with trace gate closed");
    assert_eq!(m[0].level, log::Level::Warn);
    assert_schema(m[0], "exact-ambiguous", "get_file_comments");

    // plausibility: comment.line=2 + selected_text="hello world", file line 2 = "hello World!".
    set_ipc_trace_enabled(true);
    let comments = vec![make_comment("c-plaus", Some(2), Some("hello world"))];
    let lines = vec!["first", "hello World!", "third"];
    let _ = match_comments(&comments, &lines, "/tmp/a.md", "get_file_comments");
    let evts = drain();
    let m = matching_lines(&evts);
    assert_eq!(m.len(), 1);
    assert_eq!(m[0].level, log::Level::Info);
    assert_schema(m[0], "plausibility", "get_file_comments");

    // line-fallback: comment.line=2, no selected_text.
    let comments = vec![make_comment("c-lf", Some(2), None)];
    let lines = vec!["a", "b", "c"];
    let _ = match_comments(&comments, &lines, "/tmp/a.md", "get_file_comments");
    let evts = drain();
    let m = matching_lines(&evts);
    assert_eq!(m.len(), 1);
    assert_eq!(m[0].level, log::Level::Info);
    assert_schema(m[0], "line-fallback", "get_file_comments");

    // fuzzy: comment.line=1 + selected_text="hello warld", file has "hello world" on line 2.
    // WARN regardless of gate.
    set_ipc_trace_enabled(false);
    let comments = vec![make_comment("c-fuzz", Some(1), Some("hello warld"))];
    let lines = vec!["x", "hello world", "y"];
    let _ = match_comments(&comments, &lines, "/tmp/a.md", "get_file_comments");
    let evts = drain();
    let m = matching_lines(&evts);
    assert_eq!(m.len(), 1, "fuzzy must WARN even with trace gate closed");
    assert_eq!(m[0].level, log::Level::Warn);
    assert_schema(m[0], "fuzzy", "get_file_comments");

    // orphan: completely unmatchable. Use strings that share NO chars with
    // any file line — fuzzy_score's "substring" short-circuit returns 0.9
    // when one string contains any character of the other (e.g. "abc" in
    // "completely unmatchable xyz"), so the test fixtures are deliberately
    // disjoint to guarantee step 4 fires instead of step 3.
    let comments = vec![make_comment("c-orph", Some(1), Some("zzz qqq"))];
    let lines = vec!["bbb", "ddd", "eee"];
    let _ = match_comments(&comments, &lines, "/tmp/a.md", "get_file_comments");
    let evts = drain();
    let m = matching_lines(&evts);
    assert_eq!(m.len(), 1);
    assert_eq!(m[0].level, log::Level::Warn);
    assert_schema(m[0], "orphan", "get_file_comments");
}

#[test]
fn info_events_gated_on_ipc_trace_flag() {
    let _g = test_lock().lock().unwrap_or_else(|p| p.into_inner());
    install();

    // Gate CLOSED — exact-orig / line-fallback / plausibility must NOT emit.
    set_ipc_trace_enabled(false);
    drain();
    let comments = vec![
        make_comment("c-orig", Some(2), Some("hello world")),
        make_comment("c-lf", Some(2), None),
    ];
    let lines = vec!["x", "hello world", "y"];
    let _ = match_comments(&comments, &lines, "/tmp/a.md", "get_file_comments");
    let evts = drain();
    let m = matching_lines(&evts);
    assert!(
        m.is_empty(),
        "INFO matching events must be suppressed when ipc_trace_enabled() is false; got {:?}",
        m
    );
}

#[test]
fn warn_suppressed_for_get_file_badges_caller() {
    let _g = test_lock().lock().unwrap_or_else(|p| p.into_inner());
    install();

    // Gate closed: badges call must produce ZERO matching lines for the
    // orphan/ambiguous/fuzzy outcomes (folder-badge refresh would otherwise
    // spray WARNs).
    set_ipc_trace_enabled(false);
    drain();
    let comments = vec![
        make_comment("c-orph", Some(1), Some("completely unmatchable xyz")),
        make_comment("c-amb", None, Some("hello")),
        make_comment("c-fuzz", Some(1), Some("hello warld")),
    ];
    let lines = vec!["hello world", "x", "hello there"];
    let _ = match_comments(&comments, &lines, "/tmp/a.md", "get_file_badges");
    let evts = drain();
    let m = matching_lines(&evts);
    assert!(
        m.is_empty(),
        "get_file_badges must suppress WARN matching events with gate closed; got {:?}",
        m
    );

    // With the gate open the same call emits INFO lines (the suppression
    // is WARN-only — INFO lines remain useful for `--trace` debugging).
    set_ipc_trace_enabled(true);
    drain();
    let _ = match_comments(&comments, &lines, "/tmp/a.md", "get_file_badges");
    let evts = drain();
    let m = matching_lines(&evts);
    assert_eq!(
        m.len(),
        3,
        "get_file_badges with --trace open must emit INFO for every comment"
    );
    for line in &m {
        assert_eq!(line.level, log::Level::Info);
    }
}

#[test]
fn synthetic_file_level_on_empty_file_no_matching_emit() {
    // Issue #280 forward-fix B: a legacy file-level comment (line=None,
    // selected_text=None) on an empty file must take the synthetic
    // file-level branch BEFORE the line_count==0 early-return — so it
    // stays anchored at line 1, is NOT orphaned, and emits NO [matching]
    // line (it is not a re-anchor decision).
    let _g = test_lock().lock().unwrap_or_else(|p| p.into_inner());
    install();
    set_ipc_trace_enabled(true);
    drain();

    let comments = vec![make_comment("c-file-level", None, None)];
    let lines: Vec<&str> = vec![];
    let result = match_comments(&comments, &lines, "/tmp/empty.md", "get_file_comments");

    assert_eq!(result.len(), 1);
    assert_eq!(result[0].matched_line_number, 1);
    assert!(!result[0].is_orphaned);
    assert_eq!(result[0].original_line, None);

    let evts = drain();
    let m = matching_lines(&evts);
    assert!(
        m.is_empty(),
        "synthetic file-level on empty file must not emit [matching]; got {:?}",
        m
    );
}
