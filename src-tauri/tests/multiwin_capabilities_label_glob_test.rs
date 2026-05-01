//! Capability ↔ `next_label()` glob agreement (D4, issue #315 iter 6).
//!
//! Enforces the implicit contract between
//! `src-tauri/capabilities/default.json`'s `windows: [...]` array and
//! `WindowRegistry::next_label()`. The capability's window glob
//! determines which window labels are granted the declared
//! permissions; if `next_label()` ever produced a label that no glob
//! matches, that window would silently lose every permission and IPC
//! commands from it would reject — a class of multi-window bug that is
//! near-impossible to spot in code review.
//!
//! Cites rules:
//!   * `multiwin-no-hardcoded-label` in
//!     `docs/best-practices-common/tauri/v2-patterns.md` — `"main"` is
//!     the unique unprefixed bootstrap label; secondary labels follow
//!     the `win-N` pattern produced by `next_label()`.
//!   * `caps-window-scope` (same doc) — the capability `windows` field
//!     must enumerate every label pattern the app produces; otherwise
//!     a future window is implicitly de-permissioned.
//!
//! The test is a structural property: drain N labels from a fresh
//! registry and assert each matches at least one capability glob. We
//! also pin the `"main"` bootstrap as a positive case (it is the
//! single unprefixed label that the test cannot derive from
//! `next_label()` because that function only emits the `win-N` form).

use std::path::Path;

use mdown_review_lib::registry::WindowRegistry;

/// Match a label against a single capability glob entry. Supports two
/// shapes that match the published `tauri-utils` glob semantics for
/// the capability `windows` field:
///   * literal string — exact equality
///   * trailing `*`    — prefix match on the literal portion
///
/// We deliberately reimplement the matcher here rather than reach into
/// `tauri-utils` so the test fails fast if the capability file uses an
/// unexpected glob shape (e.g. `**` or character classes). A richer
/// glob arrives only by an explicit doc/spec change, at which point
/// this matcher should be widened in the same PR.
fn label_matches_glob(label: &str, glob: &str) -> bool {
    if let Some(prefix) = glob.strip_suffix('*') {
        label.starts_with(prefix)
    } else {
        label == glob
    }
}

/// Read the `windows` array from `capabilities/default.json`. Panics
/// with a clear message if the file/field shape changes — the
/// capability schema is part of the contract this test guards.
fn read_capability_window_globs() -> Vec<String> {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("capabilities")
        .join("default.json");
    let bytes = std::fs::read_to_string(&path).unwrap_or_else(|e| {
        panic!("read {} failed: {e}", path.display());
    });
    let json: serde_json::Value = serde_json::from_str(&bytes).unwrap_or_else(|e| {
        panic!("parse {} failed: {e}", path.display());
    });
    let arr = json
        .get("windows")
        .and_then(serde_json::Value::as_array)
        .unwrap_or_else(|| {
            panic!("capability {} missing required 'windows' array", path.display())
        });
    arr.iter()
        .map(|v| {
            v.as_str()
                .unwrap_or_else(|| {
                    panic!("capability 'windows' entry is not a string: {v:?}")
                })
                .to_string()
        })
        .collect()
}

#[test]
fn next_label_output_matches_capability_glob() {
    let globs = read_capability_window_globs();
    assert!(
        !globs.is_empty(),
        "capability default.json must declare at least one window glob"
    );

    let reg = WindowRegistry::default();
    // Drain a few labels — `next_label()` is `AtomicU64::fetch_add`,
    // so the first five exercise the pattern across a non-trivial
    // counter range without becoming a stress test.
    for _ in 0..5 {
        let label = reg.next_label();
        let matched = globs.iter().any(|g| label_matches_glob(&label, g));
        assert!(
            matched,
            "next_label() produced '{label}' which matches no capability \
             glob in capabilities/default.json (windows = {globs:?}). \
             A new window with this label would silently lose every \
             permission. See multiwin-no-hardcoded-label / caps-window-scope \
             in docs/best-practices-common/tauri/v2-patterns.md."
        );
    }
}

#[test]
fn bootstrap_main_label_matches_capability_glob() {
    // The bootstrap label `"main"` is set in tauri.conf.json and never
    // produced by `next_label()`. It must match a capability glob too.
    let globs = read_capability_window_globs();
    let matched = globs.iter().any(|g| label_matches_glob("main", g));
    assert!(
        matched,
        "bootstrap label 'main' matches no capability glob in \
         capabilities/default.json (windows = {globs:?}). The main \
         window would launch with no permissions. See \
         multiwin-no-hardcoded-label in v2-patterns.md."
    );
}

// ─── Self-tests for `label_matches_glob` ──────────────────────────────

#[test]
fn glob_matches_exact_literal() {
    assert!(label_matches_glob("main", "main"));
    assert!(!label_matches_glob("main2", "main"));
    assert!(!label_matches_glob("mai", "main"));
}

#[test]
fn glob_matches_trailing_star_prefix() {
    assert!(label_matches_glob("win-1", "win-*"));
    assert!(label_matches_glob("win-99", "win-*"));
    // The empty suffix after `win-` also matches the prefix `win-`
    // itself; that is the documented `tauri-utils` glob behaviour.
    assert!(label_matches_glob("win-", "win-*"));
}

#[test]
fn glob_rejects_non_matching_prefix() {
    assert!(!label_matches_glob("other-1", "win-*"));
    assert!(!label_matches_glob("MAIN", "main")); // case-sensitive
}

#[test]
fn glob_lone_star_matches_anything() {
    // `*` strips to empty prefix → every label starts_with("") → match.
    assert!(label_matches_glob("anything", "*"));
    assert!(label_matches_glob("", "*"));
}

#[test]
fn next_label_produces_win_dash_n_form() {
    // Pin the literal shape so a future refactor that changes
    // `next_label()` (e.g. UUID-based labels) is forced to update the
    // capability `windows` field in the same PR. If this assertion
    // fails, audit `capabilities/default.json` before "fixing" it.
    let reg = WindowRegistry::default();
    let label = reg.next_label();
    assert!(
        label.starts_with("win-"),
        "next_label() returned '{label}'; expected 'win-N' form. \
         If this changed intentionally, update both this test and the \
         capability glob in capabilities/default.json."
    );
    let suffix = &label["win-".len()..];
    assert!(
        suffix.chars().all(|c| c.is_ascii_digit()),
        "next_label() suffix '{suffix}' is not numeric; capability \
         glob 'win-*' assumes a digit suffix."
    );
}
