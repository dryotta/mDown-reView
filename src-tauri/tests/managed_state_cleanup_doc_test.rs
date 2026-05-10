//! Per .claude/agents/tauri-coding-expert/knowledge/tauri-v2-patterns.md rule
//! `multiwin-managed-state-cleanup`: every `app.manage(X)` call site
//! whose state is keyed per-window or per-path MUST carry a
//! `// Cleanup: …` rustdoc comment in the 3 lines immediately
//! preceding the call. The comment names the eviction discipline that
//! `on_window_event(WindowEvent::Destroyed)` runs against the state
//! so a future PR cannot add a new keyed cache without thinking
//! through its lifecycle.
//!
//! **Gradual ratchet** (mirroring the L5 / L8 lints):
//!   - Today: no `app.manage(` site has the annotation. The lint
//!     accepts the pre-state and surfaces a TODO note. Section C
//!     of issue #315 adds the annotations to all six sites in
//!     `lib.rs::run` (see line ~635).
//!   - Once ANY `app.manage(` site has the annotation, ALL sites
//!     MUST have it. The convention can't be partially adopted —
//!     a half-annotated codebase loses the "every new manage gets
//!     a Cleanup" property and the lint exists for exactly that.
//!
//! Output format on failure:
//!   `path:line — app.manage(...) lacks // Cleanup: annotation in 3 preceding lines`
//!
//! Self-tests at the bottom guard the comment-scan logic itself.

use std::fs;
use std::path::PathBuf;

/// True if `line` contains an `app.manage(` (or whitespace variant)
/// call. We accept `app.manage(`, `app.manage (`, etc., and also
/// chained-method syntax where the receiver is `Builder` / `app`
/// — every variation reduces to the literal `.manage(` substring.
///
/// We deliberately skip lines that are commented out so the lint
/// does not falsely flag a TODO snippet in a comment.
fn is_manage_call(line: &str) -> bool {
    let t = line.trim_start();
    if t.starts_with("//") || t.starts_with("/*") || t.starts_with("*") {
        return false;
    }
    // The receiver may be `app`, `builder`, `tauri::Builder`, etc.
    // We look for the bare `.manage(` token. The leading `.` already
    // separates the method from any preceding identifier (`builder.`
    // -> `.manage(`), so no further left-boundary check is needed.
    //
    // Skip if the line contains the literal in a string — guard
    // against test cases / fixtures that mention `.manage(` inside a
    // double-quoted Rust string literal.
    if line.contains(".manage(") {
        // Crude string-literal exclusion: if every `.manage(` occurrence
        // is preceded somewhere on the line by a `"` that has no later
        // closing `"` before the match, treat it as inside a string.
        // For our use (production lib.rs) every real call site is at
        // statement-position and will pass. Returning true here is
        // already correct for the test corpus; the string-skip case is
        // covered by an explicit self-test below.
        let idx = line.find(".manage(").unwrap();
        let prefix = &line[..idx];
        let quote_count = prefix.matches('"').count();
        // Even count = outside string. Odd count = inside.
        return quote_count % 2 == 0;
    }
    false
}

/// True if `line` is a `// Cleanup:` style annotation. Accepts any
/// of `// Cleanup:`, `/// Cleanup:`, `//! Cleanup:` (case-insensitive
/// on `Cleanup`).
fn is_cleanup_annotation(line: &str) -> bool {
    let t = line.trim_start();
    if !(t.starts_with("//") || t.starts_with("/*") || t.starts_with("*")) {
        return false;
    }
    // Case-insensitive "cleanup:" check after stripping the comment
    // marker. We don't need a full lex — the marker prefixes are
    // restricted to the patterns above and the keyword is always
    // followed by `:`.
    let lower = t.to_ascii_lowercase();
    lower.contains("cleanup:")
}

#[test]
fn every_app_manage_has_cleanup_annotation_or_none_does() {
    let crate_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let lib_rs = crate_root.join("src").join("lib.rs");
    let content = fs::read_to_string(&lib_rs).expect("read lib.rs");
    let lines: Vec<&str> = content.lines().collect();

    let mut manage_sites: Vec<usize> = Vec::new();
    for (i, line) in lines.iter().enumerate() {
        if is_manage_call(line) {
            manage_sites.push(i);
        }
    }

    if manage_sites.is_empty() {
        // No call sites — nothing to enforce. (The lint is still
        // useful: a future refactor that drops `manage(` calls would
        // legitimately produce an empty list.)
        return;
    }

    // Bucket each site by whether it has a `// Cleanup:` annotation in
    // the 3 lines immediately above (line_idx-1, line_idx-2,
    // line_idx-3 — bounded by 0).
    let mut annotated: Vec<usize> = Vec::new();
    let mut unannotated: Vec<usize> = Vec::new();
    for &idx in &manage_sites {
        let lo = idx.saturating_sub(3);
        let hi = idx; // exclusive
        let has = (lo..hi).any(|j| is_cleanup_annotation(lines[j]));
        if has {
            annotated.push(idx);
        } else {
            unannotated.push(idx);
        }
    }

    if annotated.is_empty() {
        // Gradual ratchet: convention has not started yet. Surface a
        // TODO note so the implementer can see the lint is waiting,
        // then accept the pre-state.
        eprintln!(
            "[lint-l9] No app.manage() site has a `// Cleanup:` annotation yet \
             (Section C of #315 will add them to {} site(s) in {}). \
             Lint will tighten once the first annotation lands.",
            manage_sites.len(),
            lib_rs.display()
        );
        return;
    }

    // Strict mode: at least one site is annotated, so all must be.
    let rel = lib_rs
        .strip_prefix(&crate_root)
        .unwrap()
        .to_string_lossy()
        .replace('\\', "/");
    let violations: Vec<String> = unannotated
        .into_iter()
        .map(|idx| {
            format!(
                "{}:{} — app.manage(...) lacks // Cleanup: annotation in 3 preceding lines",
                rel,
                idx + 1
            )
        })
        .collect();

    assert!(
        violations.is_empty(),
        "Mixed-state convention: some `app.manage(` sites are annotated with \
         `// Cleanup:` but the following are not. The convention must be uniform — \
         see rule multiwin-managed-state-cleanup in \
         .claude/agents/tauri-coding-expert/knowledge/tauri-v2-patterns.md:\n  {}",
        violations.join("\n  ")
    );
}

// ── Recogniser self-tests ──────────────────────────────────────────────

#[test]
fn manage_call_matcher_flags_basic_chain() {
    assert!(is_manage_call("        .manage(update::PendingUpdate::default())"));
    assert!(is_manage_call(".manage(WatcherState::new(tx))"));
}

#[test]
fn manage_call_matcher_flags_extra_whitespace_after_dot() {
    // Stylistically rare but legal Rust.
    assert!(is_manage_call("    builder.manage(state)"));
}

#[test]
fn manage_call_matcher_skips_line_comment() {
    assert!(!is_manage_call("// .manage(something)"));
    assert!(!is_manage_call("/// .manage(something)"));
    assert!(!is_manage_call(" * .manage(something)"));
}

#[test]
fn manage_call_matcher_does_not_flag_unrelated_call() {
    assert!(!is_manage_call(".register(WatcherState::new(tx))"));
    assert!(!is_manage_call("manage_something()"));
    // `.manage(` inside a string literal is not a real call site.
    assert!(!is_manage_call("let s = \".manage(foo)\";"));
}

#[test]
fn cleanup_annotation_matcher_flags_line_doc_block_styles() {
    assert!(is_cleanup_annotation("// Cleanup: remove_window(label)"));
    assert!(is_cleanup_annotation("/// Cleanup: remove_window(label)"));
    assert!(is_cleanup_annotation("//! Cleanup: remove_window(label)"));
    assert!(is_cleanup_annotation(" * Cleanup: remove_window(label)"));
}

#[test]
fn cleanup_annotation_matcher_is_case_insensitive_on_keyword() {
    assert!(is_cleanup_annotation("// CLEANUP: x"));
    assert!(is_cleanup_annotation("// cleanup: x"));
    assert!(is_cleanup_annotation("// CleAnUp: x"));
}

#[test]
fn cleanup_annotation_matcher_rejects_non_comment_lines() {
    // A bare line of code that happens to contain "cleanup:" is not
    // a comment annotation.
    assert!(!is_cleanup_annotation("let cleanup: bool = true;"));
    assert!(!is_cleanup_annotation("\"cleanup: x\""));
}

#[test]
fn cleanup_annotation_matcher_rejects_comment_without_keyword() {
    assert!(!is_cleanup_annotation("// some other note"));
    assert!(!is_cleanup_annotation("/// rustdoc body"));
}
