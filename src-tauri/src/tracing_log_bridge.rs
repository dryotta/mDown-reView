//! Bridge `tracing` events to the `log` crate so they reach
//! [`tauri_plugin_log`].
//!
//! ### Why this exists
//! The codebase has historically mixed both logging APIs:
//!
//! - `lib.rs` and a handful of other call sites use `log::info!` /
//!   `log::warn!` — these reach `tauri-plugin-log` and end up in
//!   `%LocalAppData%/com.mdownreview.desktop/logs/mdownreview.log`.
//! - Most of `commands/`, `core/`, and `watcher.rs` use `tracing::info!` /
//!   `tracing::warn!` with structured fields. These were **silently
//!   dropped** before this bridge existed (no `tracing::Subscriber` was
//!   ever installed), so every "rejected: path outside workspace" warning
//!   went straight to `/dev/null` — the exact failure mode the file-level
//!   binary-source bug surfaced (2026-04-28).
//!
//! ### How
//! Install a global `tracing::Subscriber` whose only Layer forwards each
//! event to `log::log!`, preserving level + target. Field values are
//! flattened into the message body in `key=value` form so callers using
//! the structured macro syntax (`field = %expr` / `field = ?expr`)
//! produce useful single-line records in the unified log.
//!
//! Call [`install`] exactly once, immediately before / after building the
//! `tauri_plugin_log` plugin. Subsequent calls are no-ops (the global
//! default is set once for the life of the process).

use tracing::field::{Field, Visit};
use tracing::{Event, Level, Subscriber};
use tracing_subscriber::layer::{Context, SubscriberExt};
use tracing_subscriber::Layer;

/// Install the bridge as the global tracing subscriber. Idempotent — a
/// second call is a no-op. Safe to call before or after
/// `tauri_plugin_log::Builder::build()` because the bridge only depends on
/// the `log` crate facade, not on which logger is registered behind it.
pub fn install() {
    let subscriber = tracing_subscriber::Registry::default().with(TracingToLogLayer);
    // Ignore the result — `set_global_default` returns Err if a subscriber
    // is already installed (test runs, repeated init, etc.). That's fine.
    let _ = tracing::subscriber::set_global_default(subscriber);
}

/// Layer that forwards every tracing `Event` to `log::log!`. Span lifecycle
/// events are intentionally ignored — the comment IPC chokepoints and
/// every other call site we care about emit standalone events, not spans.
struct TracingToLogLayer;

impl<S: Subscriber> Layer<S> for TracingToLogLayer {
    fn on_event(&self, event: &Event<'_>, _ctx: Context<'_, S>) {
        let metadata = event.metadata();
        let level = match *metadata.level() {
            Level::ERROR => log::Level::Error,
            Level::WARN => log::Level::Warn,
            Level::INFO => log::Level::Info,
            Level::DEBUG => log::Level::Debug,
            Level::TRACE => log::Level::Trace,
        };
        // Cheap fast-path: skip flattening if the level is filtered out.
        if !log::log_enabled!(target: metadata.target(), level) {
            return;
        }
        let mut visitor = LogFieldVisitor::default();
        event.record(&mut visitor);
        let line = if visitor.fields.is_empty() {
            visitor.message
        } else if visitor.message.is_empty() {
            visitor.fields.join(" ")
        } else {
            format!("{} {}", visitor.message, visitor.fields.join(" "))
        };
        log::log!(target: metadata.target(), level, "{}", line);
    }
}

/// Visitor that flattens an `Event`'s fields into a `key=value` list, with
/// special handling for the `message` field (rendered as the bare body).
#[derive(Default)]
struct LogFieldVisitor {
    message: String,
    fields: Vec<String>,
}

impl LogFieldVisitor {
    fn push(&mut self, field: &Field, value: String) {
        if field.name() == "message" {
            self.message = value;
        } else {
            self.fields.push(format!("{}={}", field.name(), value));
        }
    }
}

impl Visit for LogFieldVisitor {
    fn record_str(&mut self, field: &Field, value: &str) {
        self.push(field, value.to_string());
    }
    fn record_debug(&mut self, field: &Field, value: &dyn std::fmt::Debug) {
        self.push(field, format!("{:?}", value));
    }
    fn record_i64(&mut self, field: &Field, value: i64) {
        self.push(field, value.to_string());
    }
    fn record_u64(&mut self, field: &Field, value: u64) {
        self.push(field, value.to_string());
    }
    fn record_bool(&mut self, field: &Field, value: bool) {
        self.push(field, value.to_string());
    }
    fn record_f64(&mut self, field: &Field, value: f64) {
        self.push(field, value.to_string());
    }
    fn record_error(&mut self, field: &Field, value: &(dyn std::error::Error + 'static)) {
        self.push(field, value.to_string());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    /// Custom log sink that records every `(level, target, message)` triple
    /// it sees. Used to verify the bridge actually forwards events.
    struct VecLogger {
        records: Arc<Mutex<Vec<(log::Level, String, String)>>>,
    }
    impl log::Log for VecLogger {
        fn enabled(&self, _: &log::Metadata) -> bool {
            true
        }
        fn log(&self, record: &log::Record) {
            self.records.lock().unwrap().push((
                record.level(),
                record.target().to_string(),
                record.args().to_string(),
            ));
        }
        fn flush(&self) {}
    }

    /// End-to-end: install the bridge, fire a structured `tracing::warn!`,
    /// verify the log sink saw the same level/target/message and that the
    /// fields were flattened into the message body.
    #[test]
    fn bridge_forwards_tracing_event_to_log_with_fields_flattened() {
        let records = Arc::new(Mutex::new(Vec::new()));
        let logger = Box::leak(Box::new(VecLogger { records: records.clone() }));
        // `set_logger` is a no-op if another logger is already set (cargo
        // test parallelism). We don't depend on this being the only logger
        // — the test below filters by target.
        let _ = log::set_logger(logger);
        log::set_max_level(log::LevelFilter::Trace);

        install();

        tracing::warn!(
            target: "mdownreview::test",
            file_path = "C:/foo.png",
            error = "path not in workspace",
            "rejected mutation"
        );

        let recs = records.lock().unwrap();
        let ours: Vec<_> = recs.iter().filter(|(_, t, _)| t == "mdownreview::test").collect();
        assert_eq!(ours.len(), 1, "expected exactly one bridged event, got: {:?}", *recs);
        let (level, _, msg) = ours[0];
        assert_eq!(*level, log::Level::Warn);
        assert!(msg.contains("rejected mutation"), "msg body missing: {msg}");
        assert!(msg.contains("file_path=C:/foo.png"), "field flatten missing: {msg}");
        assert!(msg.contains("error=path not in workspace"), "field flatten missing: {msg}");
    }
}
