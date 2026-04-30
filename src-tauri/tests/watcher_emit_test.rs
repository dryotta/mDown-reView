//! Regression tests for the watcher's `sidecar-config-changed` emit
//! (issue #304 / FLAKE-1).
//!
//! Both production call sites route through the `WatcherEmitter` trait:
//!   1. `start_watcher`'s `.mrsf.yaml` reload branch in `watcher.rs` (Bug A)
//!      — calls `mrsf_targets` + `emit_sidecar_config_changed` directly.
//!   2. `commands::sidecar_config::emit_config_changed` (Bug B) — delegates
//!      to `emit_config_changed_inner` which fans out
//!      `folder-changed` + `sidecar-config-changed` for each label returned
//!      by `mrsf_targets`.
//!
//! These tests exercise both the trait composition (helper output + per-
//! label fan-out) AND the IPC command path's inner helper. The end-to-end
//! production wiring (start_watcher → trait → AppHandle::emit_to → renderer)
//! is the responsibility of `e2e/native/06-mrsf-config-reload.spec.ts`.
//!
//! tauri::test::mock_app() is unusable here: it pulls webview2/wry GUI DLLs
//! that fail with STATUS_ENTRYPOINT_NOT_FOUND on the dev Windows host (see
//! src-tauri/tests/comments_emit_test.rs for precedent).

use mdown_review_lib::commands::sidecar_config::emit_config_changed_inner;
use mdown_review_lib::watcher::{
    mrsf_targets, FolderChangeEvent, SidecarConfigChangedEvent, WatcherEmitter,
};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

// ── Mock emitter ───────────────────────────────────────────────────────────

#[derive(Default)]
struct MockWatcherEmitter {
    /// `(label, event_name, json_path)` per emit. Records BOTH event types so
    /// the IPC command's inner helper can be unit-tested without smuggling
    /// two separate mocks.
    entries: Mutex<Vec<(String, &'static str, String)>>,
}

impl MockWatcherEmitter {
    fn entries(&self) -> Vec<(String, &'static str, String)> {
        self.entries.lock().unwrap().clone()
    }
    fn count(&self) -> usize {
        self.entries.lock().unwrap().len()
    }
}

impl WatcherEmitter for MockWatcherEmitter {
    fn emit_folder_changed(&self, label: &str, ev: &FolderChangeEvent) {
        self.entries
            .lock()
            .unwrap()
            .push((label.to_string(), "folder-changed", ev.path.clone()));
    }
    fn emit_sidecar_config_changed(&self, label: &str, ev: &SidecarConfigChangedEvent) {
        self.entries
            .lock()
            .unwrap()
            .push((label.to_string(), "sidecar-config-changed", ev.path.clone()));
    }
}

// ── Helpers ────────────────────────────────────────────────────────────────

fn tree_with(entries: &[(&str, &[&Path])]) -> HashMap<String, HashSet<PathBuf>> {
    entries
        .iter()
        .map(|(label, dirs)| {
            (
                (*label).to_string(),
                dirs.iter().map(|p| (*p).to_path_buf()).collect(),
            )
        })
        .collect()
}

// ── mrsf_targets pure helper ───────────────────────────────────────────────

#[test]
fn mrsf_targets_returns_label_when_window_tracks_root() {
    let root = PathBuf::from("/work/proj");
    let tree = tree_with(&[("window-1", &[root.as_path()])]);
    assert_eq!(mrsf_targets(&root, &tree), vec!["window-1".to_string()]);
}

#[test]
fn mrsf_targets_returns_empty_when_no_window_tracks_root() {
    let root = PathBuf::from("/work/proj");
    let other = PathBuf::from("/elsewhere");
    let tree = tree_with(&[("window-1", &[other.as_path()])]);
    assert!(mrsf_targets(&root, &tree).is_empty());
}

#[test]
fn mrsf_targets_returns_subset_when_some_windows_track() {
    let root = PathBuf::from("/work/proj");
    let other = PathBuf::from("/elsewhere");
    let tree = tree_with(&[
        ("window-a", &[root.as_path()]),
        ("window-b", &[other.as_path()]),
        ("window-c", &[root.as_path(), other.as_path()]),
    ]);

    let mut got = mrsf_targets(&root, &tree);
    got.sort();
    assert_eq!(got, vec!["window-a".to_string(), "window-c".to_string()]);
}

/// Architect's exact-match guidance: a window watching `/parent` must NOT
/// receive `sidecar-config-changed` for `/parent/child`. Each opened folder
/// resolves its own `.mrsf.yaml` independently.
#[test]
fn mrsf_targets_uses_exact_match_not_prefix() {
    let parent = PathBuf::from("/parent");
    let child = PathBuf::from("/parent/child");
    let tree = tree_with(&[("window-1", &[parent.as_path()])]);
    assert!(
        mrsf_targets(&child, &tree).is_empty(),
        "child query must not match parent-tracking window"
    );
}

// ── Trait-level emit fan-out (start_watcher branch — Bug A) ────────────────

/// Integration-style: simulate the `start_watcher` `.mrsf.yaml` branch by
/// computing `mrsf_targets` and calling `emit_sidecar_config_changed` for
/// each — exactly what the production loop does after Bug A's fix. Verifies
/// the trait records `(label, "sidecar-config-changed", path)` ONLY for the
/// windows tracking the root, and a non-tracking window receives ZERO events
/// (mandatory negative companion per test-expert review).
#[test]
fn simulated_mrsf_change_emits_only_to_tracking_windows() {
    let root = PathBuf::from("/work/proj");
    let unrelated = PathBuf::from("/elsewhere");

    let tree = tree_with(&[
        ("window-tracker-a", &[root.as_path()]),
        ("window-tracker-b", &[root.as_path()]),
        ("window-bystander", &[unrelated.as_path()]),
    ]);

    let emitter = MockWatcherEmitter::default();
    let event = SidecarConfigChangedEvent {
        path: root.to_string_lossy().into_owned(),
    };

    for label in mrsf_targets(&root, &tree) {
        emitter.emit_sidecar_config_changed(&label, &event);
    }

    let entries = emitter.entries();
    assert_eq!(
        entries.len(),
        2,
        "exactly two tracking windows should receive the event; got {entries:?}"
    );

    // No bystander leak — the negative half of the contract.
    assert!(
        !entries.iter().any(|(label, _, _)| label == "window-bystander"),
        "non-tracking window must receive ZERO events; got {entries:?}"
    );

    let mut labels: Vec<String> = entries
        .iter()
        .map(|(label, name, payload_path)| {
            assert_eq!(*name, "sidecar-config-changed");
            assert_eq!(payload_path, &event.path);
            label.clone()
        })
        .collect();
    labels.sort();
    assert_eq!(
        labels,
        vec![
            "window-tracker-a".to_string(),
            "window-tracker-b".to_string()
        ]
    );
}

/// When no window tracks the changed root, the watcher must not emit at all
/// — guards against a regression where `mrsf_targets` accidentally returns
/// every label (e.g. a future refactor flipping the filter predicate).
#[test]
fn simulated_mrsf_change_with_no_targets_emits_nothing() {
    let root = PathBuf::from("/work/proj");
    let other = PathBuf::from("/elsewhere");
    let tree = tree_with(&[("window-1", &[other.as_path()])]);

    let emitter = MockWatcherEmitter::default();
    let event = SidecarConfigChangedEvent {
        path: root.to_string_lossy().into_owned(),
    };
    for label in mrsf_targets(&root, &tree) {
        emitter.emit_sidecar_config_changed(&label, &event);
    }

    assert_eq!(emitter.count(), 0);
}

// ── IPC command emit_config_changed_inner (Bug B) ──────────────────────────

/// Bug B regression at the IPC command boundary: each tracking window must
/// receive BOTH `folder-changed` and `sidecar-config-changed` for the
/// changed root, and the non-tracking bystander must receive ZERO events.
/// If a future refactor reverts `emit_config_changed` to iterating
/// `webview_windows()` and broadcasting via `app.emit(...)`, the bystander
/// assertion fails.
#[test]
fn emit_config_changed_inner_emits_both_events_to_tracking_windows() {
    let root = PathBuf::from("/work/proj");
    let unrelated = PathBuf::from("/elsewhere");

    let tree = tree_with(&[
        ("window-tracker-a", &[root.as_path()]),
        ("window-tracker-b", &[root.as_path()]),
        ("window-bystander", &[unrelated.as_path()]),
    ]);

    let emitter = MockWatcherEmitter::default();
    emit_config_changed_inner(&emitter, &tree, &root);

    let entries = emitter.entries();
    // 2 events × 2 tracking windows = 4 entries; bystander = 0.
    assert_eq!(
        entries.len(),
        4,
        "expected 4 entries (2 events × 2 tracking windows); got {entries:?}"
    );
    assert!(
        !entries.iter().any(|(label, _, _)| label == "window-bystander"),
        "bystander must receive ZERO events; got {entries:?}"
    );

    // Each tracking window receives both event types.
    for tracker in ["window-tracker-a", "window-tracker-b"] {
        let names: Vec<&'static str> = entries
            .iter()
            .filter(|(label, _, _)| label == tracker)
            .map(|(_, name, _)| *name)
            .collect();
        assert!(
            names.contains(&"folder-changed"),
            "{tracker} missing folder-changed; got {names:?}"
        );
        assert!(
            names.contains(&"sidecar-config-changed"),
            "{tracker} missing sidecar-config-changed; got {names:?}"
        );
    }
}

/// Symmetric negative: when no window tracks the root, the inner helper
/// must emit nothing at all (zero `folder-changed`, zero
/// `sidecar-config-changed`).
#[test]
fn emit_config_changed_inner_emits_nothing_when_no_window_tracks_root() {
    let root = PathBuf::from("/work/proj");
    let a = PathBuf::from("/elsewhere/a");
    let b = PathBuf::from("/elsewhere/b");
    let tree = tree_with(&[
        ("window-1", &[a.as_path()]),
        ("window-2", &[b.as_path()]),
    ]);

    let emitter = MockWatcherEmitter::default();
    emit_config_changed_inner(&emitter, &tree, &root);

    assert_eq!(emitter.count(), 0, "no window tracks root; expected zero emits");
}

/// Bug B regression guard (issue #304 / FLAKE-1): the production wrapper
/// `emit_config_changed` MUST delegate to `emit_config_changed_inner` via
/// the `WatcherEmitter` trait. A revert of the wrapper to bypass the trait
/// (e.g. `app.emit(...)` broadcast or
/// `for win in app.webview_windows().values()`) would re-introduce Bug B.
///
/// Scope: assertions run against the BODY of `fn emit_config_changed(...)`
/// only — not the whole file — so they're not satisfied by the helper's
/// own definition (`fn emit_config_changed_inner(...)`).
///
/// `tauri::test::mock_app()` is unavailable on the dev Windows host
/// (STATUS_ENTRYPOINT_NOT_FOUND, see `comments_emit_test.rs:17-19`);
/// architecture.md rule 25 cites `src/__tests__/no-ts-sidecar-writes.test.ts`
/// as the canonical precedent for source-level structural enforcement of
/// chokepoint discipline when runtime oracles are unavailable.
///
/// Trade-off (acknowledged): this test is intentionally tightly coupled to
/// the wrapper's current shape. A legitimate refactor (renaming
/// `emit_config_changed_inner`, replacing the trait with a different
/// abstraction, or moving the wrapper) requires updating this test in the
/// same PR. Accepted vs the alternative: leaving the wrapper untested
/// against revert.
#[test]
fn emit_config_changed_wrapper_routes_through_trait_seam() {
    let source_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("src/commands/sidecar_config.rs");
    let source = std::fs::read_to_string(&source_path)
        .expect("sidecar_config.rs must be readable for structural assertion");

    // Locate `fn emit_config_changed(` (the wrapper). The trailing `(`
    // distinguishes it from `fn emit_config_changed_inner(`. Allow optional
    // visibility prefix (`pub`, `pub(crate)`).
    let lines: Vec<&str> = source.lines().collect();
    let wrapper_start_idx = lines
        .iter()
        .position(|line| {
            let trimmed = line.trim_start();
            trimmed.starts_with("fn emit_config_changed(")
                || trimmed.starts_with("pub fn emit_config_changed(")
                || trimmed.starts_with("pub(crate) fn emit_config_changed(")
        })
        .expect(
            "fn emit_config_changed( wrapper not found in sidecar_config.rs — \
             did the function get renamed? Update this test.",
        );

    // Brace-counter: scan forward from the wrapper signature line; depth goes
    // 0 → 1 at the opening `{`, then back to 0 at the matching closing `}`.
    // Robust to opening brace on same or following line; ignores braces in
    // string/char literals and comments only at a level of fidelity that's
    // fine for this file (no such literals appear in the wrapper).
    let mut wrapper_body_lines: Vec<&str> = Vec::new();
    let mut depth: i32 = 0;
    let mut started = false;
    for line in &lines[wrapper_start_idx..] {
        wrapper_body_lines.push(line);
        for ch in line.chars() {
            match ch {
                '{' => {
                    depth += 1;
                    started = true;
                }
                '}' => {
                    depth -= 1;
                }
                _ => {}
            }
        }
        if started && depth == 0 {
            break;
        }
    }
    assert!(
        started && depth == 0,
        "could not parse wrapper body — brace counting failed for fn emit_config_changed(",
    );
    let body = wrapper_body_lines.join("\n");

    // Helper: scan the wrapper body line-by-line, ignoring comment lines
    // (the design-rationale comment on `emit_config_changed_inner` cites
    // the old broken pattern when explaining what was fixed).
    let body_non_comment_contains = |needle: &str| -> bool {
        body.lines().any(|line| {
            let trimmed = line.trim();
            if trimmed.starts_with("//") || trimmed.starts_with("///") || trimmed.starts_with("//!")
            {
                return false;
            }
            trimmed.contains(needle)
        })
    };

    // Assertion 1: wrapper MUST delegate to the inner helper. Scoped to the
    // wrapper body so the helper's own signature line cannot satisfy it.
    assert!(
        body_non_comment_contains("emit_config_changed_inner("),
        "fn emit_config_changed( wrapper must call emit_config_changed_inner( \
         — Bug B regression guard. Body:\n{body}",
    );

    // Assertion 2: wrapper body MUST NOT iterate webview_windows (Bug B revert).
    assert!(
        !body_non_comment_contains("webview_windows().values()"),
        "fn emit_config_changed( wrapper must not iterate webview_windows().values() \
         — that's the Bug B broadcast pattern. Use mrsf_targets via the \
         WatcherEmitter trait. Body:\n{body}",
    );

    // Assertion 3: wrapper body MUST NOT call app.emit() (broadcast). Allow
    // `app.emit_to(...)` (per-window). Match `.emit(` not preceded by `_to`.
    let calls_broadcast_emit = body.lines().any(|line| {
        let trimmed = line.trim();
        if trimmed.starts_with("//") || trimmed.starts_with("///") || trimmed.starts_with("//!") {
            return false;
        }
        trimmed.contains("app.emit(") || trimmed.contains(".emit(\"")
    });
    assert!(
        !calls_broadcast_emit,
        "fn emit_config_changed( wrapper must not call app.emit() (broadcast) \
         — use emit_config_changed_inner which routes through emit_to. Body:\n{body}",
    );
}

/// The recorded `path` field on both event payloads must match the canonical
/// root passed in, so the renderer can dispatch reliably (string equality
/// against the active workspace root in `useFileWatcher`).
#[test]
fn emit_config_changed_inner_payload_includes_canonical_root() {
    let root = PathBuf::from("/work/proj");
    let tree = tree_with(&[("window-1", &[root.as_path()])]);
    let expected_path = root.to_string_lossy().into_owned();

    let emitter = MockWatcherEmitter::default();
    emit_config_changed_inner(&emitter, &tree, &root);

    let entries = emitter.entries();
    assert_eq!(entries.len(), 2, "single tracker × 2 events; got {entries:?}");
    for (label, name, payload_path) in &entries {
        assert_eq!(label, "window-1");
        assert_eq!(payload_path, &expected_path, "{name} payload path mismatch");
    }
}
