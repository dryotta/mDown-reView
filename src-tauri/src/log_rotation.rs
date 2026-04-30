//! Pre-init log archive + retention helper.
//!
//! Runs as a Tauri plugin registered BEFORE `tauri-plugin-log` so that
//! by the time the log plugin opens `mdownreview.log` for append, the
//! previous session's file (if any) has already been renamed to a
//! UTC-timestamped sibling and the directory has been pruned to at most
//! [`DEFAULT_KEEP`] files. Each app launch therefore begins with a
//! fresh, empty active log file and disk usage is bounded across launches.
//!
//! Plugin registration order is a stable Tauri v2 contract — see
//! `tauri-plugin-single-instance`'s "register first" docs for the same
//! guarantee. Registration order is enforced in `lib.rs::run` (this
//! plugin must come before `log_plugin`).
//!
//! Pruning matches both our startup-archive naming
//! (`mdownreview.<UTC stamp>.log`) and `tauri-plugin-log`'s own
//! intra-session size-rotation naming (`mdownreview_<stamp>.log`, with
//! an underscore — see `tauri-plugin-log` 2.x source). Without the
//! underscore branch, long-running sessions that exceed the 5 MB
//! intra-session cap would leak unbounded archives.
//!
//! See `docs/features/logging.md` for the user-facing description and
//! `docs/architecture.md` rule 2 for the single-logging-chokepoint rule
//! this complements.

use chrono::{DateTime, Utc};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::{fs, io};

/// Active log file name written by `tauri-plugin-log` (file_name
/// = `"mdownreview"`). Hard-coded here rather than re-derived from the
/// plugin builder so the rotator stays in lockstep with `lib.rs::run`.
const ACTIVE_FILE: &str = "mdownreview.log";
/// Common prefix shared by the active log and every archived sibling.
const FILE_PREFIX: &str = "mdownreview";
/// Common suffix.
const FILE_SUFFIX: &str = ".log";
/// Default retention cap — keep at most this many `mdownreview*.log`
/// files (active + archives combined) in the log directory after each
/// startup prune.
pub(crate) const DEFAULT_KEEP: usize = 10;

/// Stamp format used for archived file names: ISO-8601 UTC with `:`
/// replaced by `-` so the result is a valid filename on every supported
/// platform (Windows forbids `:` in path components).
const STAMP_FMT: &str = "%Y-%m-%dT%H-%M-%SZ";

/// Outcome of a single startup rotation pass.
///
/// Captured at plugin-setup time and stashed in a process-global
/// [`OnceLock`] so the main `.setup` hook (which runs AFTER
/// `tauri-plugin-log` has opened the new file) can emit a structured
/// `[startup]` log line summarizing what happened. The rotator's own
/// `setup` cannot use `log::info!` because the plugin behind that
/// facade hasn't initialized yet.
#[derive(Debug, Default)]
pub(crate) struct RotationOutcome {
    /// Path of the archived previous log, or `None` if there was no
    /// non-empty prior log to rename (first launch, or last session
    /// crashed before writing anything).
    pub archived: Option<PathBuf>,
    /// Paths actually deleted by `prune_logs`. Empty when under cap.
    pub pruned: Vec<PathBuf>,
    /// Best-effort error strings from archive/prune. Logged via
    /// `eprintln!` immediately AND surfaced in the main setup hook's
    /// summary; the rotator never fails the app on its own.
    pub errors: Vec<String>,
}

static OUTCOME: OnceLock<RotationOutcome> = OnceLock::new();

/// Surface the rotation outcome through the standard logging chokepoint.
///
/// Called from the main `.setup` hook in `lib.rs::run` AFTER
/// `tauri-plugin-log` has initialized. Emits one `log::info!` summary
/// line on `target: "log-rotation"` plus one `log::warn!` per error.
///
/// A separate `target` (not `"startup"`) is used because the line shape
/// — `archived=<path> pruned_count=<n> errors=<n>` — does not match the
/// `[startup] phase=<name> t_ms=<n>` schema documented in
/// `docs/observability.md`. Analyzers filter by `target`, not by line
/// prefix; routing this to `"log-rotation"` keeps `[startup]` schema-
/// pure and lets log-aggregation tooling pull rotation events without
/// substring-matching.
pub(crate) fn surface_outcome() {
    let Some(rotation) = OUTCOME.get() else {
        return;
    };
    let archived = rotation
        .archived
        .as_ref()
        .map(|p| p.display().to_string())
        .unwrap_or_else(|| "none".to_string());
    log::info!(
        target: "log-rotation",
        "[log-rotation] archived={archived} pruned_count={} errors={}",
        rotation.pruned.len(),
        rotation.errors.len()
    );
    for err in &rotation.errors {
        log::warn!(target: "log-rotation", "[log-rotation] error: {err}");
    }
}

/// If `<log_dir>/mdownreview.log` exists and is non-empty, rename it to
/// `<log_dir>/mdownreview.<UTC stamp>.log`. On collision (a previous
/// archive used the exact same second) append `.<n>` and bump `n` until
/// a free slot is found.
///
/// Returns the archived path on success, `Ok(None)` if no rename was
/// performed (active file missing, empty, or `log_dir` itself missing).
///
/// `now` is injected for testability; production callers pass
/// `chrono::Utc::now()`.
pub(crate) fn archive_active_log(
    log_dir: &Path,
    now: DateTime<Utc>,
) -> io::Result<Option<PathBuf>> {
    if !log_dir.exists() {
        return Ok(None);
    }
    let active = log_dir.join(ACTIVE_FILE);
    let metadata = match fs::metadata(&active) {
        Ok(m) => m,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e),
    };
    if metadata.len() == 0 {
        return Ok(None);
    }

    let stamp = now.format(STAMP_FMT).to_string();
    let mut candidate = log_dir.join(format!("{FILE_PREFIX}.{stamp}{FILE_SUFFIX}"));
    let mut suffix: u32 = 1;
    while candidate.exists() {
        candidate = log_dir.join(format!("{FILE_PREFIX}.{stamp}.{suffix}{FILE_SUFFIX}"));
        suffix += 1;
    }
    fs::rename(&active, &candidate)?;
    Ok(Some(candidate))
}

/// Delete oldest-by-mtime `mdownreview*.log` archives until at most
/// `keep` files (active + archives combined) remain in `log_dir`.
///
/// The active file `mdownreview.log` is **never** deleted, even if it
/// has the oldest mtime — robustness against archive→prune ordering
/// changes. Returns the paths actually deleted; empty Vec when under
/// cap or `log_dir` is missing.
///
/// Two archive naming patterns are matched: our startup-archive form
/// `mdownreview.<token>.log` AND `tauri-plugin-log`'s own
/// intra-session size-rotation form `mdownreview_<token>.log` (note
/// the underscore). Unrelated files such as `mdownreview-cli.log`
/// (hyphen), `notes.md`, or `other.log` are ignored.
pub(crate) fn prune_logs(log_dir: &Path, keep: usize) -> io::Result<Vec<PathBuf>> {
    if !log_dir.exists() {
        return Ok(Vec::new());
    }

    let mut active_present = false;
    let mut archives: Vec<(PathBuf, std::time::SystemTime)> = Vec::new();

    for dirent in fs::read_dir(log_dir)? {
        let dirent = dirent?;
        let raw_name = dirent.file_name();
        let Some(name) = raw_name.to_str() else {
            continue;
        };
        if name == ACTIVE_FILE {
            active_present = true;
            continue;
        }
        if !name.starts_with(FILE_PREFIX) || !name.ends_with(FILE_SUFFIX) {
            continue;
        }
        // Accept both `.` (our startup-archive separator) and `_`
        // (tauri-plugin-log's intra-session rotation separator).
        // Reject `mdownreview-cli.log` (hyphen) and similar unrelated
        // names whose middle is empty or otherwise begins with neither.
        let middle = &name[FILE_PREFIX.len()..name.len() - FILE_SUFFIX.len()];
        let first = middle.chars().next();
        if first != Some('.') && first != Some('_') {
            continue;
        }
        let metadata = dirent.metadata()?;
        let mtime = metadata.modified()?;
        archives.push((dirent.path(), mtime));
    }

    let active_count = usize::from(active_present);
    let total = archives.len() + active_count;
    if total <= keep {
        return Ok(Vec::new());
    }

    archives.sort_by_key(|&(_, mtime)| mtime); // oldest first
    let to_delete = (total - keep).min(archives.len());

    let mut deleted = Vec::with_capacity(to_delete);
    for (path, _) in archives.iter().take(to_delete) {
        match fs::remove_file(path) {
            Ok(()) => deleted.push(path.clone()),
            // Race with another process is benign — the file is gone,
            // which was the goal. Continue.
            Err(e) if e.kind() == io::ErrorKind::NotFound => {}
            Err(e) => return Err(e),
        }
    }
    Ok(deleted)
}

/// Build the `log-rotator` Tauri plugin. **Must be registered BEFORE
/// `tauri_plugin_log`** — the plugin's setup hook archives the previous
/// `mdownreview.log` (if any) and prunes the directory to
/// [`DEFAULT_KEEP`] files, all before the log plugin opens the file for
/// append.
///
/// Failures are best-effort: archive/prune errors are stashed in the
/// process-global [`RotationOutcome`] and surfaced via `eprintln!` (the
/// log plugin isn't up yet, so `log::info!` would be dropped). The
/// caller's main `.setup` hook re-emits the outcome via a structured
/// `tracing::info!` once the log plugin is active.
pub(crate) fn plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    use tauri::Manager;
    tauri::plugin::Builder::new("log-rotator")
        .setup(|app, _api| {
            let mut outcome = RotationOutcome::default();
            match app.path().app_log_dir() {
                Ok(dir) => {
                    // First launch on a clean machine: the log dir
                    // doesn't exist yet. Create it so prune/archive
                    // see an empty (but real) directory and the log
                    // plugin doesn't have to create it itself.
                    if let Err(e) = fs::create_dir_all(&dir) {
                        outcome.errors.push(format!("create_dir_all failed: {e}"));
                    }
                    match archive_active_log(&dir, Utc::now()) {
                        Ok(p) => outcome.archived = p,
                        Err(e) => outcome.errors.push(format!("archive failed: {e}")),
                    }
                    match prune_logs(&dir, DEFAULT_KEEP) {
                        Ok(d) => outcome.pruned = d,
                        Err(e) => outcome.errors.push(format!("prune failed: {e}")),
                    }
                }
                Err(e) => outcome
                    .errors
                    .push(format!("app_log_dir unavailable: {e}")),
            }

            // Best-effort dev-time visibility — the log plugin isn't up
            // yet, so eprintln! is the only reliable channel.
            for err in &outcome.errors {
                eprintln!("[log-rotator] {err}");
            }
            // Set is fallible iff this plugin's setup runs twice in the
            // same process. That shouldn't happen — Tauri plugins are
            // process-singletons — but ignoring the return is correct
            // either way: the first outcome wins.
            let _ = OUTCOME.set(outcome);
            Ok(())
        })
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;
    use std::io::Write;
    use std::time::{Duration, SystemTime};
    use tempfile::TempDir;

    /// Helper: write `content` to `path` and force its modified-time to
    /// `mtime` via `File::set_modified`. Stable since Rust 1.75; used in
    /// place of `thread::sleep` to keep the prune-ordering tests
    /// deterministic per `docs/test-strategy.md` (no time-based sleeps).
    fn write_with_mtime(path: &Path, content: &[u8], mtime: SystemTime) {
        let mut f = File::create(path).unwrap();
        f.write_all(content).unwrap();
        f.sync_all().unwrap();
        f.set_modified(mtime).unwrap();
    }

    fn fake_now() -> DateTime<Utc> {
        DateTime::parse_from_rfc3339("2026-04-30T15:30:45Z")
            .unwrap()
            .with_timezone(&Utc)
    }

    // ---- archive_active_log -------------------------------------------------

    #[test]
    fn archive_noop_when_dir_missing() {
        // Use a path under TempDir to avoid Z:\ etc. drive-letter
        // assumptions on Windows runners.
        let parent = TempDir::new().unwrap();
        let missing = parent.path().join("nonexistent-subdir");
        assert_eq!(archive_active_log(&missing, fake_now()).unwrap(), None);
    }

    #[test]
    fn archive_noop_when_log_missing() {
        let dir = TempDir::new().unwrap();
        assert_eq!(archive_active_log(dir.path(), fake_now()).unwrap(), None);
    }

    #[test]
    fn archive_skips_empty_log() {
        let dir = TempDir::new().unwrap();
        File::create(dir.path().join("mdownreview.log")).unwrap();
        assert_eq!(archive_active_log(dir.path(), fake_now()).unwrap(), None);
        assert!(
            dir.path().join("mdownreview.log").exists(),
            "empty active file should be left in place"
        );
    }

    #[test]
    fn archive_renames_nonempty_log() {
        let dir = TempDir::new().unwrap();
        let active = dir.path().join("mdownreview.log");
        let payload = b"hello\nlog line\n";
        std::fs::write(&active, payload).unwrap();

        let archived = archive_active_log(dir.path(), fake_now()).unwrap().unwrap();

        assert!(!active.exists(), "active should be renamed away");
        assert!(archived.exists(), "archived path should exist");
        // Byte-for-byte content equality — proves we renamed (not
        // copied or truncated) the original.
        let bytes = std::fs::read(&archived).unwrap();
        assert_eq!(
            bytes, payload,
            "archive content must match original byte-for-byte"
        );
    }

    #[test]
    fn archive_uses_utc_timestamp_format_roundtrip() {
        let dir = TempDir::new().unwrap();
        std::fs::write(dir.path().join("mdownreview.log"), b"x").unwrap();
        let now = fake_now();

        let archived = archive_active_log(dir.path(), now).unwrap().unwrap();
        let name = archived.file_name().unwrap().to_str().unwrap();
        assert_eq!(name, "mdownreview.2026-04-30T15-30-45Z.log");

        // Round-trip the stamp back through chrono and confirm equality
        // with the `now` we injected.
        let stamp = name
            .strip_prefix("mdownreview.")
            .unwrap()
            .strip_suffix(".log")
            .unwrap();
        let parsed = chrono::NaiveDateTime::parse_from_str(stamp, STAMP_FMT).unwrap();
        assert_eq!(parsed.and_utc(), now);
    }

    #[test]
    fn archive_handles_double_collision() {
        // Subsumes the single-collision case: this test pre-places both
        // `mdownreview.<stamp>.log` AND `mdownreview.<stamp>.1.log`,
        // forcing the helper to walk the suffix sequence twice and
        // settle on `.2`. If single-collision regressed (helper used
        // `.0` or didn't bump), this test would also fail.
        let dir = TempDir::new().unwrap();
        let now = fake_now();
        std::fs::write(
            dir.path().join("mdownreview.2026-04-30T15-30-45Z.log"),
            b"first",
        )
        .unwrap();
        std::fs::write(
            dir.path().join("mdownreview.2026-04-30T15-30-45Z.1.log"),
            b"second",
        )
        .unwrap();
        std::fs::write(dir.path().join("mdownreview.log"), b"third").unwrap();

        let archived = archive_active_log(dir.path(), now).unwrap().unwrap();
        assert_eq!(
            archived.file_name().unwrap().to_str().unwrap(),
            "mdownreview.2026-04-30T15-30-45Z.2.log"
        );
        // Confirm the third launch's content went into the new archive.
        assert_eq!(std::fs::read(&archived).unwrap(), b"third");
    }

    // ---- prune_logs ---------------------------------------------------------

    #[test]
    fn prune_includes_plugin_intra_session_archives() {
        // Regression: tauri-plugin-log's intra-session size rotation
        // produces files like `mdownreview_<timestamp>.log` (note the
        // UNDERSCORE separator, not a dot). With `RotationStrategy::
        // KeepAll` they accumulate forever unless prune covers them.
        // See `tauri-plugin-log` 2.x source — the parser strips
        // `"mdownreview"` then `"_"` to extract its rotation timestamp.
        let dir = TempDir::new().unwrap();
        let base = SystemTime::now() - Duration::from_secs(3600);
        // 6 of our startup archives (dot-separator)
        for i in 0..6u64 {
            write_with_mtime(
                &dir.path().join(format!("mdownreview.startup-{i:02}.log")),
                b"x",
                base + Duration::from_secs(i * 60),
            );
        }
        // 5 plugin intra-session archives (underscore-separator)
        for i in 0..5u64 {
            write_with_mtime(
                &dir.path()
                    .join(format!("mdownreview_2026-01-{:02}_00-00-00.log", i + 1)),
                b"x",
                base + Duration::from_secs((i + 6) * 60),
            );
        }
        // 11 archives total, keep=10 → must delete 1 oldest.
        let deleted = prune_logs(dir.path(), 10).unwrap();
        assert_eq!(deleted.len(), 1);
        // The oldest is the first dot-archive (mtime = base + 0).
        assert_eq!(
            deleted[0].file_name().unwrap().to_str().unwrap(),
            "mdownreview.startup-00.log"
        );
        // Sanity: 10 survivors remain (5 underscore + 5 dot).
        let survivors: Vec<String> = std::fs::read_dir(dir.path())
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().to_string())
            .collect();
        assert_eq!(survivors.len(), 10);
    }

    #[test]
    fn prune_noop_when_dir_missing() {
        let parent = TempDir::new().unwrap();
        let missing = parent.path().join("nonexistent-subdir");
        assert!(prune_logs(&missing, 10).unwrap().is_empty());
    }

    #[test]
    fn prune_no_op_when_under_cap() {
        let dir = TempDir::new().unwrap();
        for i in 0..5 {
            std::fs::write(
                dir.path().join(format!(
                    "mdownreview.2026-01-{:02}T00-00-00Z.log",
                    i + 1
                )),
                b"x",
            )
            .unwrap();
        }
        assert!(prune_logs(dir.path(), 10).unwrap().is_empty());
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 5);
    }

    #[test]
    fn prune_keeps_at_most_n_oldest_first() {
        let dir = TempDir::new().unwrap();
        let base = SystemTime::now() - Duration::from_secs(3600);
        // 15 archives with strictly increasing mtimes.
        for i in 0..15u64 {
            let path = dir
                .path()
                .join(format!("mdownreview.archive-{i:02}.log"));
            write_with_mtime(&path, b"x", base + Duration::from_secs(i * 60));
        }

        let deleted = prune_logs(dir.path(), 10).unwrap();
        assert_eq!(deleted.len(), 5, "should delete 15 - 10 = 5 oldest");

        // Returned paths actually got deleted from disk.
        for path in &deleted {
            assert!(
                !path.exists(),
                "{} should have been deleted",
                path.display()
            );
        }
        // Survivors: archive-05 .. archive-14 (newest 10 by mtime).
        for i in 0..15u64 {
            let p = dir
                .path()
                .join(format!("mdownreview.archive-{i:02}.log"));
            assert_eq!(
                p.exists(),
                i >= 5,
                "file mdownreview.archive-{i:02}.log survival mismatch"
            );
        }
    }

    #[test]
    fn prune_uses_mtime_not_filename_lex_order() {
        let dir = TempDir::new().unwrap();
        let base = SystemTime::now() - Duration::from_secs(3600);
        // Newer mtime but lexically EARLIER filename.
        write_with_mtime(
            &dir.path().join("mdownreview.2020-01-01T00-00-00Z.log"),
            b"new",
            base + Duration::from_secs(600),
        );
        // Older mtime but lexically LATER filename.
        write_with_mtime(
            &dir.path().join("mdownreview.2099-01-01T00-00-00Z.log"),
            b"old",
            base,
        );

        let deleted = prune_logs(dir.path(), 1).unwrap();
        assert_eq!(deleted.len(), 1);
        assert!(
            deleted[0]
                .file_name()
                .unwrap()
                .to_str()
                .unwrap()
                .starts_with("mdownreview.2099"),
            "should delete file with OLDER mtime regardless of lex order"
        );
    }

    #[test]
    fn prune_ignores_unrelated_files() {
        let dir = TempDir::new().unwrap();
        // Decoys that must NOT be touched.
        std::fs::write(dir.path().join("other.log"), b"x").unwrap();
        std::fs::write(dir.path().join("mdownreview.txt"), b"x").unwrap();
        std::fs::write(dir.path().join("notes.md"), b"x").unwrap();
        std::fs::write(dir.path().join("mdownreview-cli.log"), b"x").unwrap();

        // 11 matching archives forces a single deletion.
        let base = SystemTime::now() - Duration::from_secs(3600);
        for i in 0..11u64 {
            write_with_mtime(
                &dir.path()
                    .join(format!("mdownreview.archive-{i:02}.log")),
                b"x",
                base + Duration::from_secs(i * 60),
            );
        }

        let deleted = prune_logs(dir.path(), 10).unwrap();
        assert_eq!(deleted.len(), 1);
        // Decoys preserved.
        assert!(dir.path().join("other.log").exists());
        assert!(dir.path().join("mdownreview.txt").exists());
        assert!(dir.path().join("notes.md").exists());
        assert!(
            dir.path().join("mdownreview-cli.log").exists(),
            "mdownreview-cli.log must NOT match the prefix.something.log pattern"
        );
    }

    #[test]
    fn prune_returns_paths_actually_deleted() {
        let dir = TempDir::new().unwrap();
        let base = SystemTime::now() - Duration::from_secs(3600);
        for i in 0..12u64 {
            write_with_mtime(
                &dir.path()
                    .join(format!("mdownreview.archive-{i:02}.log")),
                b"x",
                base + Duration::from_secs(i * 60),
            );
        }
        let deleted = prune_logs(dir.path(), 10).unwrap();
        let survivors: Vec<String> = std::fs::read_dir(dir.path())
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().to_string())
            .collect();
        assert_eq!(survivors.len(), 10);
        let deleted_names: Vec<String> = deleted
            .iter()
            .map(|p| p.file_name().unwrap().to_string_lossy().to_string())
            .collect();
        for d in &deleted_names {
            assert!(
                !survivors.contains(d),
                "{d} should not survive prune but is still on disk",
            );
        }
    }

    #[test]
    fn prune_keeps_active_file_even_when_oldest() {
        let dir = TempDir::new().unwrap();
        let base = SystemTime::now() - Duration::from_secs(3600);
        // Active file is OLDEST by mtime — must still survive.
        write_with_mtime(&dir.path().join("mdownreview.log"), b"active", base);
        // 11 archives, all newer than the active.
        for i in 0..11u64 {
            write_with_mtime(
                &dir.path()
                    .join(format!("mdownreview.archive-{i:02}.log")),
                b"x",
                base + Duration::from_secs((i + 1) * 60),
            );
        }

        // Total = 12 (1 active + 11 archives), keep = 10 → must delete
        // 2 oldest archives (NOT the active file even though it's
        // mtime-oldest).
        let deleted = prune_logs(dir.path(), 10).unwrap();
        assert_eq!(deleted.len(), 2);
        assert!(
            dir.path().join("mdownreview.log").exists(),
            "active file MUST survive prune even when it has oldest mtime"
        );
        for d in &deleted {
            let n = d.file_name().unwrap().to_str().unwrap();
            assert!(
                n.starts_with("mdownreview.archive-0"),
                "deleted {n}, expected archive-00 or archive-01"
            );
        }
    }

    #[test]
    fn prune_handles_zero_keep() {
        // Defensive: if a future caller passes keep=0 we should delete
        // every archive but still preserve the active file.
        let dir = TempDir::new().unwrap();
        std::fs::write(dir.path().join("mdownreview.log"), b"active").unwrap();
        std::fs::write(
            dir.path().join("mdownreview.2020-01-01T00-00-00Z.log"),
            b"x",
        )
        .unwrap();
        let deleted = prune_logs(dir.path(), 0).unwrap();
        // 2 total, keep=0 → delete 2 but only archive is eligible.
        assert_eq!(deleted.len(), 1);
        assert!(dir.path().join("mdownreview.log").exists());
        assert!(
            !dir.path()
                .join("mdownreview.2020-01-01T00-00-00Z.log")
                .exists()
        );
    }
}
