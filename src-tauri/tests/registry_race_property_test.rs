//! Property test for rule `multiwin-atomic-registry-mutations`
//! (.claude/agents/tauri-coding-expert/knowledge/tauri-v2-patterns.md): under N concurrent
//! `WindowRegistry::try_claim_folder` calls for the same canonical folder,
//! exactly one returns `Ok` and the registry holds exactly one
//! `WindowKind::Folder(path)` entry pointing at the test path.
//!
//! Why this test matters: the read-then-register pattern that
//! `try_claim_folder` replaces let two concurrent CLI launches
//! (single-instance forwarding + macOS `RunEvent::Opened`) both decide
//! `CreateFolder` for the same canonical path and both `register`,
//! breaking the one-folder-one-window invariant. This test stress-tests
//! the atomic-claim API at `src-tauri/src/registry.rs:152` to catch any
//! future regression that would weaken the lock discipline.
//!
//! Concurrency primitive: `tokio::spawn` + `JoinSet` (tokio is already a
//! dev-dependency with the `rt-multi-thread` feature). 8 worker tasks on
//! a 4-thread runtime exercise true parallelism — a Mutex bug under
//! contention shows up as `oks > 1` here while staying invisible in the
//! single-threaded `try_claim_folder_*` unit tests.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use mdown_review_lib::registry::{WindowKind, WindowRegistry};

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn concurrent_claims_preserve_one_folder_one_window() {
    const N: usize = 8;
    let reg = Arc::new(WindowRegistry::default());

    // Pre-register N file-only windows so try_claim_folder has labels
    // to claim. (try_claim_folder rejects unregistered labels.)
    for i in 0..N {
        reg.register(format!("win-{i}"), WindowKind::FileOnly);
    }

    let path = PathBuf::from("/projects/foo");
    let mut set = tokio::task::JoinSet::new();
    for i in 0..N {
        let reg = Arc::clone(&reg);
        let path = path.clone();
        set.spawn(async move {
            let label = format!("win-{i}");
            (label, reg.try_claim_folder(&format!("win-{i}"), path))
        });
    }

    let mut results: Vec<(String, Result<(), String>)> = Vec::with_capacity(N);
    while let Some(joined) = set.join_next().await {
        results.push(joined.expect("spawned task panicked"));
    }

    // Property 1: exactly one Ok across all concurrent claims.
    let oks: Vec<&String> = results
        .iter()
        .filter_map(|(label, r)| if r.is_ok() { Some(label) } else { None })
        .collect();
    assert_eq!(
        oks.len(),
        1,
        "exactly one win should successfully claim — got {} ok labels: {:?}; full results: {:?}",
        oks.len(),
        oks,
        results
    );

    // Property 2: every Err carries the existing claimant's label —
    // never an unrelated string. (Defends against a future regression
    // that swaps `Err(existing.label)` for `Err("conflict")`.)
    let winning_label = oks[0].clone();
    for (label, r) in &results {
        if let Err(msg) = r {
            assert_eq!(
                msg, &winning_label,
                "loser {label} should receive winner's label as Err; got {msg:?}"
            );
        }
    }

    // Property 3: registry now contains exactly one entry whose kind is
    // `Folder(path)` and whose label is the winner. Inspected via the
    // public `find_by_folder` API (no `entries_snapshot` exists, and
    // the spec authorises this fallback).
    let owner = reg.find_by_folder(Path::new("/projects/foo"));
    assert_eq!(
        owner,
        Some(winning_label.clone()),
        "find_by_folder should return the winning label"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn concurrent_claims_distinct_paths_all_succeed() {
    // Companion property: when each concurrent claim targets a distinct
    // path, all N succeed (the lock must not over-serialise — claims for
    // different folders are independent).
    const N: usize = 8;
    let reg = Arc::new(WindowRegistry::default());
    for i in 0..N {
        reg.register(format!("win-{i}"), WindowKind::FileOnly);
    }

    let mut set = tokio::task::JoinSet::new();
    for i in 0..N {
        let reg = Arc::clone(&reg);
        let path = PathBuf::from(format!("/projects/p-{i}"));
        set.spawn(async move {
            let label = format!("win-{i}");
            reg.try_claim_folder(&label, path)
        });
    }

    let mut all_ok = true;
    while let Some(joined) = set.join_next().await {
        if joined.expect("spawned task panicked").is_err() {
            all_ok = false;
        }
    }
    assert!(
        all_ok,
        "every distinct-path claim should succeed; one or more failed"
    );

    // Each path has exactly one owner.
    for i in 0..N {
        let p = PathBuf::from(format!("/projects/p-{i}"));
        assert_eq!(
            reg.find_by_folder(&p),
            Some(format!("win-{i}")),
            "win-{i} should own /projects/p-{i}"
        );
    }
}
