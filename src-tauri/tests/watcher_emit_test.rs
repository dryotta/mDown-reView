//! Regression suite for issue #304 / FLAKE-1 — the watcher MUST emit
//! `sidecar-config-changed` to the renderer's window-scoped listener
//! channel via `Emitter::emit_to(self, label, …)` per
//! `docs/design-patterns.md` rule 4 (Rust emits window-scoped events,
//! never app-wide broadcasts).
//!
//! Two production bugs the trait + helper exercised here are designed
//! to prevent:
//!
//! * Bug A — `start_watcher`'s `.mrsf.yaml` branch reloaded the in-memory
//!   `SidecarConfigState` but never told the renderer, leaving ghost
//!   panels stale on external edits.
//! * Bug B — `commands::sidecar_config::emit_config_changed` used
//!   `for win in app.webview_windows().values()` (global broadcast) and
//!   sent a `()` payload to `sidecar-config-changed`. Should be
//!   `emit_to(label, …)` filtered by `tree_watched_dirs`.
//!
//! Why not `tauri::test::mock_app()` — same reason as
//! `comments_emit_test.rs:19-23`: the `tauri = features = ["test"]`
//! dev-dep pulls webview2/wry GUI DLLs that fail with
//! STATUS_ENTRYPOINT_NOT_FOUND on the dev Windows host. The trait seam
//! keeps these tests fast and platform-portable.
//!
//! Verification command (revert + re-run to confirm fail-then-pass):
//!   # In src/watcher.rs comment out the `emit_sidecar_config_changed`
//!   # call inside the `.mrsf.yaml` branch.
//!   cargo test --test watcher_emit_test
//!   # `simulated_mrsf_change_emits_only_to_tracking_windows` fails;
//!   # re-apply the emit; cargo test → green.

use mdown_review_lib::watcher::{
    mrsf_targets, FileChangeEvent, FolderChangeEvent, SidecarConfigChangedEvent, WatcherEmitter,
};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

// ── Mock emitter ───────────────────────────────────────────────────────────

#[derive(Default)]
struct MockWatcherEmitter {
    events: Mutex<Vec<(String, String, String)>>, // (label, event_name, json_payload)
}

impl MockWatcherEmitter {
    fn entries(&self) -> Vec<(String, String, String)> {
        self.events.lock().unwrap().clone()
    }
    fn count(&self) -> usize {
        self.events.lock().unwrap().len()
    }
    fn record(&self, label: &str, event_name: &str, payload: &impl serde::Serialize) {
        let json = serde_json::to_string(payload).unwrap();
        self.events
            .lock()
            .unwrap()
            .push((label.to_string(), event_name.to_string(), json));
    }
}

impl WatcherEmitter for MockWatcherEmitter {
    fn emit_file_changed(&self, label: &str, ev: &FileChangeEvent) {
        self.record(label, "file-changed", ev);
    }
    fn emit_folder_changed(&self, label: &str, ev: &FolderChangeEvent) {
        self.record(label, "folder-changed", ev);
    }
    fn emit_sidecar_config_changed(&self, label: &str, ev: &SidecarConfigChangedEvent) {
        self.record(label, "sidecar-config-changed", ev);
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

// ── Trait-level emit fan-out ───────────────────────────────────────────────

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

    let expected_payload = serde_json::to_string(&event).unwrap();
    let mut labels: Vec<String> = entries
        .iter()
        .map(|(label, name, payload)| {
            assert_eq!(name, "sidecar-config-changed");
            assert_eq!(payload, &expected_payload);
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
