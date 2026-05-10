//! Property tests for rule `multiwin-args-delivery`
//! (.claude/agents/tauri-coding-expert/knowledge/tauri-v2-patterns.md) — the registry's
//! per-window pending-args queue.
//!
//! The rule says: when creating a new window we `push_args` then emit
//! `args-received` so the renderer drains the queue. The queue MUST be:
//!   * window-scoped (push to win-1, drain from win-1 only),
//!   * cleaned up on `unregister(label)` (no leak after window destroy),
//!   * NOT recreated by a late `push_args` after `unregister` (panel
//!     review bug #9 — verified-future-state today, ignored placeholder
//!     until the fix lands).
//!
//! Property 1 + 2 are asserted strictly against today's behaviour.
//! Property 3 is ignored with a FIXME pointing at the future fix.

use mdown_review_lib::core::types::LaunchArgs;
use mdown_review_lib::registry::{WindowKind, WindowRegistry};

fn args(files: &[&str]) -> LaunchArgs {
    LaunchArgs {
        files: files.iter().map(|s| (*s).to_string()).collect(),
        folders: Vec::new(),
    }
}

#[test]
fn push_then_drain_returns_args_and_clears_queue() {
    // Property 1: round-trip — push then drain returns the args, and
    // a subsequent drain returns empty.
    let reg = WindowRegistry::new();
    reg.register("win-1".into(), WindowKind::FileOnly);

    reg.push_args("win-1", args(&["/a.md", "/b.md"]));

    let drained = reg.drain_args("win-1");
    assert_eq!(
        drained.files,
        vec!["/a.md".to_string(), "/b.md".to_string()],
        "first drain should return all pushed files in order"
    );

    let drained_again = reg.drain_args("win-1");
    assert!(
        drained_again.files.is_empty() && drained_again.folders.is_empty(),
        "queue must be empty after drain — got {drained_again:?}"
    );
}

#[test]
fn unregister_clears_pending_args_no_leak() {
    // Property 2: a destroyed window's pending args do NOT leak — the
    // unregister path MUST drop the queue entry. This is the
    // `multiwin-managed-state-cleanup` invariant for the registry's
    // pending-args map (see v2-patterns.md rule).
    let reg = WindowRegistry::new();
    reg.register("win-1".into(), WindowKind::FileOnly);
    reg.push_args("win-1", args(&["/secret.md"]));

    reg.unregister("win-1");

    // Drain after unregister must return empty — no phantom args
    // surviving the window's lifecycle.
    let post = reg.drain_args("win-1");
    assert!(
        post.files.is_empty() && post.folders.is_empty(),
        "unregister must clear pending args — got {post:?} after destroy"
    );
}

#[test]
fn push_args_isolates_across_windows() {
    // Property 2b: per-window keying — pushing to win-1 must not affect
    // win-2's queue (and vice versa). Companion to the cross-window
    // sandbox-escape concern in `multiwin-allowlist-scope`: pending args
    // must never silently surface in the wrong window.
    let reg = WindowRegistry::new();
    reg.register("win-1".into(), WindowKind::FileOnly);
    reg.register("win-2".into(), WindowKind::FileOnly);

    reg.push_args("win-1", args(&["/win1.md"]));
    reg.push_args("win-2", args(&["/win2.md"]));

    let d1 = reg.drain_args("win-1");
    let d2 = reg.drain_args("win-2");
    assert_eq!(d1.files, vec!["/win1.md".to_string()]);
    assert_eq!(d2.files, vec!["/win2.md".to_string()]);
}

#[test]
#[ignore = "P3.3 — pending bug #9 fix: late push_args after unregister \
            currently creates a phantom queue entry"]
fn late_push_after_unregister_does_not_create_phantom_entry() {
    // FIXME (issue #315 panel review bug #9): today the `pending_args`
    // map is a HashMap<String, Vec<LaunchArgs>>; a `push_args(label, …)`
    // after `unregister(label)` will recreate the entry via
    // `entry(...).or_default().push(...)`. This leaves a phantom queue
    // that no live window will ever drain, leaking memory across the
    // session and (worse) silently surfacing in a future window that
    // happens to be assigned the same label.
    //
    // When the fix lands (probably: gate `push_args` against a "live
    // labels" set populated by `register` and cleared by `unregister`),
    // enable this test and assert:
    //   - reg.register("win-1", FileOnly)
    //   - reg.unregister("win-1")
    //   - reg.push_args("win-1", args(&["/late.md"]))   // no-op
    //   - reg.drain_args("win-1") returns empty
    panic!(
        "placeholder — must be implemented when bug #9 fix lands and \
         late push_args after unregister becomes a no-op"
    );
}
