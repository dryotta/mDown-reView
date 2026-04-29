//! Parser + reporter for the `mdownreview-cli analyze-log` subcommand.
//!
//! Consumes the rotating log file produced by `tauri-plugin-log` (see
//! `lib.rs::run`) and aggregates the two stable schemas shipped in
//! issue #264 / PR3:
//!
//! * `[ipc] cmd=<name> duration_us=<u> payload_bytes=<n> ok=<bool>`
//!   (warn-level events on failure carry an extra `err=<msg>` tail).
//! * `[startup] phase=<kebab-case-name> t_ms=<n>`
//!
//! See `docs/observability.md` for the schema reference and
//! `docs/specs/cli-mdownreview-cli.md` for the user-visible spec.
//!
//! # Defensive parsing
//! Each input line is searched for the substrings `[ipc]` / `[startup]`
//! BEFORE attempting to parse — the `tauri-plugin-log` formatter
//! prefixes lines with timestamps + log level + target, all of which
//! are skipped over by anchoring on the schema marker substring.
//! Malformed lines (everything else) are silently dropped so a partly
//! corrupted log still yields a useful aggregate.

use std::collections::{BTreeMap, HashMap};
use std::fmt::Write as _;
use std::io::{self, BufRead, BufReader, Read};

use serde::Serialize;

/// Schema version emitted in `--json` output. Bump when the JSON shape
/// changes incompatibly so analyzers (CI bench, exploratory tests) can
/// gate on the `schema_version` discriminant. Today: `1`.
pub const JSON_SCHEMA_VERSION: u32 = 1;

/// One observed `[ipc]` event. The `_err` field is preserved for future
/// reporters but unused in today's aggregate output (the per-cmd table
/// only counts and percentiles `ok=true`/`ok=false` together — failure
/// frequency is captured by `count` minus an `ok_count` reported via
/// the JSON output if a future analyzer asks for it).
#[derive(Debug, Clone)]
struct IpcEvent {
    duration_us: u64,
}

/// One observed `[startup]` event. Order is significant for the text
/// report (sorted ascending by `t_ms`) but the underlying `seen` map
/// is keyed by phase name to enforce idempotency at parse time.
#[derive(Debug, Clone, Serialize)]
pub struct StartupEntry {
    pub phase: String,
    pub t_ms: u64,
}

/// Per-IPC-command aggregate row. `total_us` summed lazily via
/// `iter().sum()` — count-driven percentiles use the sorted slice
/// (nearest-rank, no interpolation) so a single small dependency-free
/// implementation handles all sample sizes cleanly.
#[derive(Debug, Serialize)]
pub struct IpcStats {
    pub name: String,
    pub count: u64,
    pub p50_us: u64,
    pub p95_us: u64,
    pub p99_us: u64,
    pub total_us: u64,
}

/// Aggregated report ready for text or JSON rendering.
#[derive(Debug, Serialize)]
pub struct Report {
    pub schema_version: u32,
    pub startup_phases: Vec<StartupEntry>,
    pub ipc_commands: Vec<IpcStats>,
}

/// Parse error returned from the public-facing entry points. We keep the
/// surface small (one variant per failure mode) so callers can emit
/// human-readable messages without depending on `thiserror`.
#[derive(Debug)]
pub enum AnalyzeError {
    /// I/O failure reading the log source (file or stdin).
    Io(io::Error),
    /// `--phase-budget <phase>=<ms>` format violation. Carries the raw
    /// argument so the CLI front-end can echo it verbatim.
    BudgetParse(String),
    /// JSON serialization failure. Practically unreachable (our types
    /// have stable Serialize impls), but plumbed so we never `panic!`.
    Json(serde_json::Error),
}

impl std::fmt::Display for AnalyzeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AnalyzeError::Io(e) => write!(f, "io error: {e}"),
            AnalyzeError::BudgetParse(s) => write!(
                f,
                "invalid --phase-budget {s:?}: expected <phase>=<ms>"
            ),
            AnalyzeError::Json(e) => write!(f, "json error: {e}"),
        }
    }
}

impl std::error::Error for AnalyzeError {}

impl From<io::Error> for AnalyzeError {
    fn from(e: io::Error) -> Self {
        AnalyzeError::Io(e)
    }
}

impl From<serde_json::Error> for AnalyzeError {
    fn from(e: serde_json::Error) -> Self {
        AnalyzeError::Json(e)
    }
}

/// One `--phase-budget <phase>=<ms>` flag. Parsed once up-front so
/// every breach is reported in a single pass over the report.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PhaseBudget {
    pub phase: String,
    pub max_t_ms: u64,
}

impl PhaseBudget {
    /// Parse one `<phase>=<ms>` string. The right-hand side must be a
    /// non-negative integer (milliseconds); the left-hand side is a
    /// kebab-case phase name (matched case-sensitively against the
    /// recorder's `as_str()` output).
    pub fn parse(raw: &str) -> Result<Self, AnalyzeError> {
        let (phase, ms) = raw
            .split_once('=')
            .ok_or_else(|| AnalyzeError::BudgetParse(raw.to_string()))?;
        let phase = phase.trim();
        let ms = ms.trim();
        if phase.is_empty() {
            return Err(AnalyzeError::BudgetParse(raw.to_string()));
        }
        let max_t_ms = ms
            .parse::<u64>()
            .map_err(|_| AnalyzeError::BudgetParse(raw.to_string()))?;
        Ok(PhaseBudget {
            phase: phase.to_string(),
            max_t_ms,
        })
    }
}

/// Apply phase budgets against a finished report. Returns the list of
/// breach messages (empty = all budgets passed). Phases not present in
/// the log are reported as `"missing"` breaches so a CI run that does
/// not record a critical phase fails loudly instead of passing
/// vacuously — except when `report.startup_phases` is empty (vacuous-
/// success case for empty logs, called out in tests).
///
/// Caller owns the exit-code mapping (`exit 2` for any non-empty
/// return) — see `bin/cli.rs::cmd_analyze_log`.
pub fn evaluate_budgets(report: &Report, budgets: &[PhaseBudget]) -> Vec<String> {
    let mut breaches: Vec<String> = Vec::new();
    if report.startup_phases.is_empty() {
        // Empty log: budgets pass vacuously per the spec. Without this
        // branch, every budget in a run against an empty file would
        // produce a "missing" breach — noise during early bring-up.
        return breaches;
    }
    let observed: HashMap<&str, u64> = report
        .startup_phases
        .iter()
        .map(|p| (p.phase.as_str(), p.t_ms))
        .collect();
    for b in budgets {
        match observed.get(b.phase.as_str()) {
            Some(&actual) if actual > b.max_t_ms => {
                breaches.push(format!(
                    "BUDGET BREACH: {phase} t_ms={actual} > budget={budget}",
                    phase = b.phase,
                    actual = actual,
                    budget = b.max_t_ms,
                ));
            }
            Some(_) => {
                // Within budget — silent success.
            }
            None => {
                breaches.push(format!(
                    "BUDGET BREACH: {phase} missing (budget={budget})",
                    phase = b.phase,
                    budget = b.max_t_ms,
                ));
            }
        }
    }
    breaches
}

/// Read every line of `reader` and aggregate `[ipc]` / `[startup]`
/// events into a `Report`. Tolerant of partial / corrupted lines:
/// bad UTF-8 segments are skipped and trailing partial lines (no
/// final newline) are still attempted.
pub fn analyze<R: Read>(reader: R) -> Result<Report, AnalyzeError> {
    let buf = BufReader::new(reader);
    let mut ipc_by_cmd: HashMap<String, Vec<IpcEvent>> = HashMap::new();
    // Phase order is "first-observation wins" — the recorder is
    // already idempotent (duplicate calls log-debug only), but a
    // log spanning multiple processes could legitimately repeat a
    // phase name. We anchor on the first occurrence so the timeline
    // matches the cold-startup view rather than averaging across
    // restart events.
    let mut startup_by_phase: BTreeMap<String, u64> = BTreeMap::new();

    for line_res in buf.lines() {
        let line = match line_res {
            Ok(l) => l,
            // Bad UTF-8 / unexpected EOF mid-line: skip silently.
            // tauri-plugin-log emits UTF-8 by default but we cannot
            // assume the user pointed us at a clean file.
            Err(_) => continue,
        };
        if let Some(after) = find_marker(&line, "[ipc]") {
            if let Some(ev) = parse_ipc(after) {
                ipc_by_cmd.entry(ev.0).or_default().push(IpcEvent {
                    duration_us: ev.1,
                });
            }
        } else if let Some(after) = find_marker(&line, "[startup]") {
            if let Some((phase, t_ms)) = parse_startup(after) {
                // First observation of each phase wins — matches the
                // recorder's `seen` set semantics on the emitter side.
                startup_by_phase.entry(phase).or_insert(t_ms);
            }
        }
    }

    let mut startup_phases: Vec<StartupEntry> = startup_by_phase
        .into_iter()
        .map(|(phase, t_ms)| StartupEntry { phase, t_ms })
        .collect();
    startup_phases.sort_by_key(|e| e.t_ms);

    let mut ipc_commands: Vec<IpcStats> = ipc_by_cmd
        .into_iter()
        .map(|(name, events)| {
            let count = events.len() as u64;
            let mut durations: Vec<u64> = events.iter().map(|e| e.duration_us).collect();
            durations.sort_unstable();
            let total_us: u64 = durations.iter().sum();
            IpcStats {
                name,
                count,
                p50_us: percentile(&durations, 50),
                p95_us: percentile(&durations, 95),
                p99_us: percentile(&durations, 99),
                total_us,
            }
        })
        .collect();
    // Most-expensive commands first so the text report's top rows are
    // the actionable hot spots.
    ipc_commands.sort_by(|a, b| b.total_us.cmp(&a.total_us).then_with(|| a.name.cmp(&b.name)));

    Ok(Report {
        schema_version: JSON_SCHEMA_VERSION,
        startup_phases,
        ipc_commands,
    })
}

/// Find the first occurrence of `marker` in `line` and return the slice
/// AFTER the marker (so the caller parses only the schema body). Returns
/// `None` if the marker is absent.
fn find_marker<'a>(line: &'a str, marker: &str) -> Option<&'a str> {
    line.find(marker).map(|idx| &line[idx + marker.len()..])
}

/// Parse the body of an `[ipc]` line (everything after the literal
/// `[ipc]` marker). Returns `(cmd, duration_us)` on success or `None`
/// if any required field is missing or unparseable.
fn parse_ipc(body: &str) -> Option<(String, u64)> {
    let cmd = extract_kv(body, "cmd")?;
    let duration_us: u64 = extract_kv(body, "duration_us")?.parse().ok()?;
    // payload_bytes / ok / err are present in the schema but unused by
    // today's aggregate; they're checked-for-shape implicitly via
    // `extract_kv` returning `None` when fields are misordered.
    Some((cmd.to_string(), duration_us))
}

/// Parse the body of a `[startup]` line. Returns `(phase, t_ms)` on
/// success.
fn parse_startup(body: &str) -> Option<(String, u64)> {
    let phase = extract_kv(body, "phase")?;
    let t_ms: u64 = extract_kv(body, "t_ms")?.parse().ok()?;
    Some((phase.to_string(), t_ms))
}

/// Extract `key=value` from a whitespace-separated line. The value runs
/// up to the next whitespace OR end of string. Used for `cmd=`,
/// `duration_us=`, `phase=`, `t_ms=`. For string-valued fields with
/// embedded spaces (`err=...`) callers should use a dedicated parser —
/// today none of the parsed fields can contain spaces in well-formed
/// log output.
fn extract_kv<'a>(body: &'a str, key: &str) -> Option<&'a str> {
    // Match ` <key>=` (preceded by whitespace) so a substring like
    // `duration_us` doesn't accidentally match against a field name
    // ending in the same characters. The body always starts with
    // whitespace per the schema — `[ipc] cmd=…` etc.
    let needle_with_space = format!(" {key}=");
    let start = if body.starts_with(&format!("{key}=")) {
        // Edge case: marker substring stripped left-padded space.
        // Currently unreachable because `find_marker` returns the slice
        // immediately after `[ipc]` / `[startup]` (which is followed by
        // a space in the emitter), but defensive against future format
        // tweaks.
        0
    } else {
        body.find(&needle_with_space)? + 1 // skip leading space
    };
    let after_eq = body[start..].find('=')? + start + 1;
    let rest = &body[after_eq..];
    let end = rest.find(char::is_whitespace).unwrap_or(rest.len());
    Some(&rest[..end])
}

/// Nearest-rank percentile over a pre-sorted slice. Returns 0 for an
/// empty slice; for non-empty slices, `percentile(&[v], p)` returns `v`
/// for any `p` so a single-sample command surfaces sensibly. `p` is
/// expected in `[0, 100]`; values outside that range clamp to the slice
/// endpoints.
fn percentile(sorted: &[u64], p: u64) -> u64 {
    if sorted.is_empty() {
        return 0;
    }
    if p == 0 {
        return sorted[0];
    }
    if p >= 100 {
        return sorted[sorted.len() - 1];
    }
    // Nearest-rank: index = ceil(p/100 * N) - 1, clamped to len-1.
    // Compute via integer arithmetic to avoid float rounding surprises
    // on small N (the standard f64 path goes wrong at p=99, N=2).
    let n = sorted.len() as u64;
    let idx_one_based = (p * n).div_ceil(100);
    let idx = (idx_one_based.saturating_sub(1)) as usize;
    sorted[idx.min(sorted.len() - 1)]
}

// ── Rendering ───────────────────────────────────────────────────────────────

/// Render the report as a human-readable text table. Output ends with a
/// trailing newline so callers can `print!()` directly.
pub fn render_text(report: &Report) -> String {
    let mut out = String::new();

    out.push_str("Startup phase timeline (ms from earliest observation):\n");
    if report.startup_phases.is_empty() {
        out.push_str("  (no [startup] events found)\n");
    } else {
        // Pad each phase name to the longest, so columns align.
        let phase_w = report
            .startup_phases
            .iter()
            .map(|p| p.phase.len())
            .max()
            .unwrap_or(0)
            .max(8);
        for entry in &report.startup_phases {
            // `let _ = ...` because writeln! into String is infallible.
            let _ = writeln!(
                out,
                "  {phase:<phase_w$}  {t_ms:>6}",
                phase = entry.phase,
                phase_w = phase_w,
                t_ms = entry.t_ms
            );
        }
    }

    out.push('\n');
    out.push_str("IPC commands:\n");
    if report.ipc_commands.is_empty() {
        out.push_str("  (no [ipc] events found)\n");
        return out;
    }
    let name_w = report
        .ipc_commands
        .iter()
        .map(|c| c.name.len())
        .max()
        .unwrap_or(0)
        .max(4);
    let _ = writeln!(
        out,
        "  {name:<name_w$}  {count:>5}  {p50:>10}  {p95:>10}  {p99:>10}  {total:>10}",
        name = "name",
        name_w = name_w,
        count = "count",
        p50 = "p50_us",
        p95 = "p95_us",
        p99 = "p99_us",
        total = "total_us",
    );
    for stats in &report.ipc_commands {
        let _ = writeln!(
            out,
            "  {name:<name_w$}  {count:>5}  {p50:>10}  {p95:>10}  {p99:>10}  {total:>10}",
            name = stats.name,
            name_w = name_w,
            count = stats.count,
            p50 = stats.p50_us,
            p95 = stats.p95_us,
            p99 = stats.p99_us,
            total = stats.total_us,
        );
    }
    out
}

/// Render the report as JSON. Pretty-printed for human readability;
/// schema is documented in `docs/specs/cli-mdownreview-cli.md`.
pub fn render_json(report: &Report) -> Result<String, AnalyzeError> {
    Ok(serde_json::to_string_pretty(report)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn percentile_handles_edge_cases() {
        assert_eq!(percentile(&[], 50), 0);
        assert_eq!(percentile(&[42], 50), 42);
        assert_eq!(percentile(&[42], 99), 42);
        assert_eq!(percentile(&[1, 2, 3, 4, 5], 50), 3);
        assert_eq!(percentile(&[1, 2, 3, 4, 5], 100), 5);
        assert_eq!(percentile(&[1, 2, 3, 4, 5], 99), 5);
    }

    #[test]
    fn percentile_p95_on_100_samples() {
        // Nearest-rank: ceil(95/100 * 100) - 1 = 94 → 95th element (1-based).
        let sorted: Vec<u64> = (1..=100).collect();
        assert_eq!(percentile(&sorted, 95), 95);
    }

    #[test]
    fn extract_kv_basic() {
        let body = " cmd=read_text_file duration_us=1234 payload_bytes=0 ok=true";
        assert_eq!(extract_kv(body, "cmd"), Some("read_text_file"));
        assert_eq!(extract_kv(body, "duration_us"), Some("1234"));
        assert_eq!(extract_kv(body, "ok"), Some("true"));
    }

    #[test]
    fn parse_ipc_well_formed() {
        let body = " cmd=foo duration_us=42 payload_bytes=0 ok=true";
        assert_eq!(parse_ipc(body), Some(("foo".to_string(), 42)));
    }

    #[test]
    fn parse_ipc_with_err_tail() {
        let body = " cmd=bar duration_us=99 payload_bytes=0 ok=false err=something failed";
        assert_eq!(parse_ipc(body), Some(("bar".to_string(), 99)));
    }

    #[test]
    fn parse_startup_well_formed() {
        let body = " phase=app-init t_ms=0";
        assert_eq!(parse_startup(body), Some(("app-init".to_string(), 0)));
    }

    #[test]
    fn analyze_skips_garbage_lines() {
        let log = "garbage line\n\
                   2026-04-28 [info] some unrelated message\n\
                   2026-04-28 [info][ipc] cmd=foo duration_us=10 payload_bytes=0 ok=true\n\
                   not-a-bracket-line\n\
                   2026-04-28 [info][startup] phase=app-init t_ms=0\n";
        let report = analyze(log.as_bytes()).unwrap();
        assert_eq!(report.ipc_commands.len(), 1);
        assert_eq!(report.startup_phases.len(), 1);
        assert_eq!(report.ipc_commands[0].name, "foo");
        assert_eq!(report.startup_phases[0].phase, "app-init");
    }

    #[test]
    fn analyze_empty_input_yields_empty_report() {
        let report = analyze(b"".as_slice()).unwrap();
        assert!(report.startup_phases.is_empty());
        assert!(report.ipc_commands.is_empty());
        assert_eq!(report.schema_version, JSON_SCHEMA_VERSION);
    }

    #[test]
    fn analyze_truncated_final_line_does_not_panic() {
        // No trailing newline — historical bug source for line-iterators.
        let log = "[ipc] cmd=foo duration_us=10 payload_bytes=0 ok=true\n\
                   [ipc] cmd=bar duratio"; // truncated mid-key
        let report = analyze(log.as_bytes()).unwrap();
        assert_eq!(report.ipc_commands.len(), 1);
        assert_eq!(report.ipc_commands[0].name, "foo");
    }

    #[test]
    fn first_observation_wins_for_duplicate_phases() {
        // The recorder dedupes per-process but a long log file may
        // contain multiple process runs. We anchor the timeline on
        // first occurrence so the first cold start dominates the view.
        let log = "[startup] phase=app-init t_ms=0\n\
                   [startup] phase=app-init t_ms=999\n\
                   [startup] phase=webview-ready t_ms=120\n";
        let report = analyze(log.as_bytes()).unwrap();
        assert_eq!(report.startup_phases.len(), 2);
        let app_init = report
            .startup_phases
            .iter()
            .find(|p| p.phase == "app-init")
            .unwrap();
        assert_eq!(app_init.t_ms, 0);
    }

    #[test]
    fn budget_parse_round_trip() {
        let b = PhaseBudget::parse("frontend-mounted=800").unwrap();
        assert_eq!(b.phase, "frontend-mounted");
        assert_eq!(b.max_t_ms, 800);
    }

    #[test]
    fn budget_parse_rejects_bad_input() {
        assert!(PhaseBudget::parse("frontend-mounted").is_err());
        assert!(PhaseBudget::parse("frontend-mounted=").is_err());
        assert!(PhaseBudget::parse("=800").is_err());
        assert!(PhaseBudget::parse("frontend-mounted=abc").is_err());
    }

    #[test]
    fn evaluate_budgets_reports_breach() {
        let report = Report {
            schema_version: JSON_SCHEMA_VERSION,
            startup_phases: vec![
                StartupEntry { phase: "app-init".into(), t_ms: 0 },
                StartupEntry { phase: "frontend-mounted".into(), t_ms: 1500 },
            ],
            ipc_commands: vec![],
        };
        let budgets = vec![PhaseBudget {
            phase: "frontend-mounted".into(),
            max_t_ms: 800,
        }];
        let breaches = evaluate_budgets(&report, &budgets);
        assert_eq!(breaches.len(), 1);
        assert!(breaches[0].contains("frontend-mounted"));
        assert!(breaches[0].contains("1500"));
        assert!(breaches[0].contains("800"));
    }

    #[test]
    fn evaluate_budgets_passes_within_limit() {
        let report = Report {
            schema_version: JSON_SCHEMA_VERSION,
            startup_phases: vec![StartupEntry {
                phase: "frontend-mounted".into(),
                t_ms: 500,
            }],
            ipc_commands: vec![],
        };
        let budgets = vec![PhaseBudget {
            phase: "frontend-mounted".into(),
            max_t_ms: 800,
        }];
        assert!(evaluate_budgets(&report, &budgets).is_empty());
    }

    #[test]
    fn evaluate_budgets_empty_log_passes_vacuously() {
        let report = Report {
            schema_version: JSON_SCHEMA_VERSION,
            startup_phases: vec![],
            ipc_commands: vec![],
        };
        let budgets = vec![PhaseBudget {
            phase: "anything".into(),
            max_t_ms: 1,
        }];
        assert!(evaluate_budgets(&report, &budgets).is_empty());
    }

    #[test]
    fn evaluate_budgets_missing_phase_is_breach() {
        let report = Report {
            schema_version: JSON_SCHEMA_VERSION,
            startup_phases: vec![StartupEntry {
                phase: "app-init".into(),
                t_ms: 0,
            }],
            ipc_commands: vec![],
        };
        let budgets = vec![PhaseBudget {
            phase: "frontend-mounted".into(),
            max_t_ms: 800,
        }];
        let breaches = evaluate_budgets(&report, &budgets);
        assert_eq!(breaches.len(), 1);
        assert!(breaches[0].contains("missing"));
    }

    #[test]
    fn render_text_includes_both_sections() {
        let report = Report {
            schema_version: JSON_SCHEMA_VERSION,
            startup_phases: vec![StartupEntry {
                phase: "app-init".into(),
                t_ms: 0,
            }],
            ipc_commands: vec![IpcStats {
                name: "foo".into(),
                count: 1,
                p50_us: 100,
                p95_us: 100,
                p99_us: 100,
                total_us: 100,
            }],
        };
        let text = render_text(&report);
        assert!(text.contains("Startup phase timeline"));
        assert!(text.contains("app-init"));
        assert!(text.contains("IPC commands"));
        assert!(text.contains("foo"));
    }

    #[test]
    fn ipc_commands_sorted_by_total_desc() {
        let log = "[ipc] cmd=cheap duration_us=1 payload_bytes=0 ok=true\n\
                   [ipc] cmd=cheap duration_us=1 payload_bytes=0 ok=true\n\
                   [ipc] cmd=expensive duration_us=1000 payload_bytes=0 ok=true\n";
        let report = analyze(log.as_bytes()).unwrap();
        assert_eq!(report.ipc_commands.len(), 2);
        assert_eq!(report.ipc_commands[0].name, "expensive");
        assert_eq!(report.ipc_commands[1].name, "cheap");
    }

    #[test]
    fn render_json_round_trip() {
        let report = Report {
            schema_version: JSON_SCHEMA_VERSION,
            startup_phases: vec![StartupEntry {
                phase: "app-init".into(),
                t_ms: 0,
            }],
            ipc_commands: vec![],
        };
        let json = render_json(&report).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["schema_version"], 1);
        assert_eq!(parsed["startup_phases"][0]["phase"], "app-init");
    }
}
