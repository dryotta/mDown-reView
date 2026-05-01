//! Placeholder for rule `multiwin-allowlist-scope`
//! (docs/best-practices-common/tauri/v2-patterns.md): once
//! `WatcherState::is_path_allowed` and `is_path_or_parent_allowed` take
//! a `window_label` argument and scope to that window's set instead of
//! unioning across all windows, this file MUST be filled in with a
//! property test that verifies window B does NOT gain mutation rights
//! for paths only window A has watched.
//!
//! Today's API (src-tauri/src/watcher.rs:54-112) takes only a `&Path`
//! and unions across all windows — this is the documented C1 violation.
//! Asserting against today's behaviour would either:
//!   * lock the violation in (a positive assertion that the union
//!     leaks B's paths into A's allowlist), OR
//!   * invert the assertion (assert the leak), which silently flips to
//!     "fail" the moment the C1 fix lands and looks like a regression.
//!
//! Both are worse than an honest `#[ignore]` placeholder. When the
//! Section C1 fix lands (window-scoped allowlist), enable this test
//! and assert the per-window isolation property.
//!
//! FIXME (issue #315 Section C1): replace the `#[ignore]` body with a
//! real property test once `is_path_allowed(window_label, path)` and
//! `is_path_or_parent_allowed(window_label, path)` exist. Suggested
//! property:
//!
//!   1. Create WatcherState; register windows "win-A" and "win-B".
//!   2. Add path /tmp/secret to win-A's `watched_paths` (via
//!      `update_watched_files` keyed by win-A's label).
//!   3. Assert win-A.is_path_allowed(/tmp/secret) → true.
//!   4. Assert win-B.is_path_allowed(/tmp/secret) → FALSE.
//!   5. Same checks for is_path_or_parent_allowed.
//!
//! Until the API gains the `window_label` parameter the test cannot
//! make a meaningful assertion, so it is `#[ignore]`-marked with this
//! explicit FIXME pointer.

#[test]
#[ignore = "P2 — pending Section C1 watcher window-scope fix (issue #315)"]
fn window_scoped_allowlist_isolates_paths_per_window() {
    // FIXME: enable when watcher API gains window_label arg and
    //        is_path_allowed scopes to the calling window's set
    //        instead of unioning across all windows. See module-level
    //        docs above for the full property to assert.
    panic!(
        "placeholder — must be implemented when issue #315 Section C1 \
         lands the window-scoped allowlist API"
    );
}
