//! Property test for rule `multiwin-canonicalize-at-ingest`
//! (.claude/agents/tauri-coding-expert/knowledge/tauri-v2-patterns.md) +
//! `fs-canonicalize-once` (docs/security.md):
//! `core::paths::canonicalize_no_verbatim` MUST be **idempotent** —
//! `canonicalize(canonicalize(p)) == canonicalize(p)` for any existing
//! path on every supported platform.
//!
//! Why this matters: the rule's enforcement model relies on
//! "canonicalize once at ingest, trust the form thereafter". If
//! `canonicalize_no_verbatim` is NOT idempotent, downstream code that
//! re-runs the helper (defensively, or by accident through a future
//! refactor) would produce a different path on the second call,
//! breaking string-equality checks across the registry / watcher /
//! sidecar layers and re-introducing the issue #89 ghost-duplicate
//! class of bugs.
//!
//! Today's implementation delegates to `dunce::canonicalize`; this test
//! locks that idempotence contract in so a future swap to a
//! verbatim-emitting canonicalizer (or a custom path normaliser) is
//! caught at test time, not at IPC-boundary mismatch time.

use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use mdown_review_lib::core::paths::canonicalize_no_verbatim;

/// Best-effort temp-file guard so a panicking assert still cleans up.
struct TempFile {
    path: PathBuf,
}

impl Drop for TempFile {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}

/// Per-test-process monotonic counter so two `unique_temp_file` calls
/// in the same test run never collide even if `SystemTime` resolution
/// is coarse. Combined with PID + nanos for cross-process uniqueness.
static COUNTER: AtomicU64 = AtomicU64::new(0);

fn unique_nonce() -> String {
    let pid = std::process::id();
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("{pid}-{nanos}-{n}")
}

fn unique_temp_file(stem: &str) -> TempFile {
    // PID + nanos + atomic counter avoids collisions for parallel
    // `cargo test` workers and within-process repeated calls. `tempfile`
    // is in dev-dependencies but a manual name keeps the cleanup path
    // visible and the produced filename predictable in failure logs.
    let path = std::env::temp_dir().join(format!("mdr-canon-{stem}-{}.tmp", unique_nonce()));
    fs::write(&path, b"x").expect("write temp file");
    TempFile { path }
}

#[test]
fn idempotent_on_existing_file() {
    let f = unique_temp_file("file");

    let once = canonicalize_no_verbatim(&f.path).expect("first canonicalize");
    let twice = canonicalize_no_verbatim(&once).expect("second canonicalize");

    assert_eq!(
        twice, once,
        "canonicalize must be idempotent — got\n  once  = {once:?}\n  twice = {twice:?}"
    );
}

#[test]
fn idempotent_on_temp_dir_root() {
    // The temp dir itself (a real, existing directory) — guards against
    // a regression where canonicalisation of dirs vs files diverges.
    let temp = std::env::temp_dir();
    let once = canonicalize_no_verbatim(&temp).expect("first canonicalize");
    let twice = canonicalize_no_verbatim(&once).expect("second canonicalize");
    assert_eq!(twice, once, "canonicalize(temp_dir) must be idempotent");
}

#[cfg(unix)]
#[test]
fn idempotent_on_symlink_target() {
    // Symlinks are the most common idempotence trap — a non-idempotent
    // canonicaliser will resolve the link on call 1 and leave the
    // resolved form unchanged on call 2 (good), but a buggy one might
    // re-prepend a prefix or normalise differently. Locked in here.
    let target = unique_temp_file("symtarget");
    let link_path = std::env::temp_dir().join(format!("mdr-canon-link-{}", unique_nonce()));
    // Best-effort symlink — skip the test cleanly on filesystems that
    // refuse symlink creation (rare on macOS/Linux, but guards against
    // exotic CI sandboxes).
    if std::os::unix::fs::symlink(&target.path, &link_path).is_err() {
        return;
    }
    // RAII cleanup for the symlink itself.
    struct LinkGuard(PathBuf);
    impl Drop for LinkGuard {
        fn drop(&mut self) {
            let _ = fs::remove_file(&self.0);
        }
    }
    let _link_guard = LinkGuard(link_path.clone());

    let once = canonicalize_no_verbatim(&link_path).expect("first canonicalize via symlink");
    let twice = canonicalize_no_verbatim(&once).expect("second canonicalize");
    assert_eq!(
        twice, once,
        "canonicalize via symlink must be idempotent — got\n  once  = {once:?}\n  twice = {twice:?}"
    );
}

#[test]
fn nonexistent_path_errors_consistently() {
    // For non-existent paths the API mirrors std::fs::canonicalize —
    // an `Err` is returned. Lock in the "consistently errors" property:
    // both calls must agree on Err-ness so callers cannot get a path
    // that round-trips on second call but failed on first (which would
    // imply a stale-cache bug in any future memoisation layer).
    let bogus = std::env::temp_dir().join(format!("mdr-canon-missing-{}.tmp", unique_nonce()));
    assert!(
        !bogus.exists(),
        "test precondition: bogus path must not exist"
    );

    let first = canonicalize_no_verbatim(&bogus);
    let second = canonicalize_no_verbatim(&bogus);
    assert!(
        first.is_err() && second.is_err(),
        "non-existent path must error on both calls — got first={first:?} second={second:?}"
    );
}
