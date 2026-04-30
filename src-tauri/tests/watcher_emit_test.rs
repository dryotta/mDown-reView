//! Regression tests for the watcher's `sidecar-config-changed` emit
//! (issue #304 / FLAKE-1).
//!
//! Two production call sites route through the same `mrsf_targets` helper
//! and `WatcherEmitter` trait:
//!   1. `start_watcher`'s `.mrsf.yaml` reload branch in `watcher.rs` (Bug A)
//!   2. `emit_config_changed` in `commands/sidecar_config.rs` (Bug B)
//!
//! These tests exercise the trait composition (helper output + per-label
//! fan-out) — the contract that both call sites depend on. The end-to-end
//! production wiring (start_watcher → trait → AppHandle::emit_to → renderer)
//! is the responsibility of `e2e/native/06-mrsf-config-reload.spec.ts`.
//!
//! tauri::test::mock_app() is unusable here: it pulls webview2/wry GUI DLLs
//! that fail with STATUS_ENTRYPOINT_NOT_FOUND on the dev Windows host (see
//! src-tauri/tests/comments_emit_test.rs for precedent).

use mdown_review_lib::watcher::{mrsf_targets, SidecarConfigChangedEvent, WatcherEmitter};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

// ── Mock emitter ───────────────────────────────────────────────────────────

#[derive(Default)]
struct MockWatcherEmitter {
    events: Mutex<Vec<(String, SidecarConfigChangedEvent)>>, // (label, payload)
}

impl MockWatcherEmitter {
    fn entries(&self) -> Vec<(String, SidecarConfigChangedEvent)> {
        self.events.lock().unwrap().clone()
    }
    fn count(&self) -> usize {
        self.events.lock().unwrap().len()
    }
}

impl WatcherEmitter for MockWatcherEmitter {
    fn emit_sidecar_config_changed(&self, label: &str, ev: &SidecarConfigChangedEvent) {
        self.events
            .lock()
            .unwrap()
            .push((label.to_string(), ev.clone()));
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
        !entries.iter().any(|(label, _)| label == "window-bystander"),
        "non-tracking window must receive ZERO events; got {entries:?}"
    );

    let mut labels: Vec<String> = entries
        .iter()
        .map(|(label, payload)| {
            assert_eq!(payload.path, event.path);
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
