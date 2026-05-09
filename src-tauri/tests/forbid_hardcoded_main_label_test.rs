//! Forbid the hardcoded `"main"` window-label literal outside the
//! bootstrap allowlist.
//!
//! Per docs/best-practices-common/tauri/v2-patterns.md rule
//! `multiwin-no-hardcoded-label`: secondary code paths must derive
//! the window label from the call context (e.g. `window.label()`,
//! registry lookups, menu-id encoding) rather than assume the bootstrap
//! "main" window. Hardcoding `"main"` works at startup but routes events
//! to the wrong window the moment a user opens a second folder window.
//!
//! Allowlist policy: only explicit entries in `ALLOW` (specific file +
//! substring pairs) and entire-file allowlist via `ALLOW_FILES` (e.g.
//! `src/registry.rs` which is the registry implementation that owns
//! the `"main"` label literal as part of its public API) are exempt.
//! Test code (`#[cfg(test)]` blocks, `tests/` directory, `*_tests.rs`
//! files) is NOT globally exempt — new Rust tests should use synthetic
//! window labels like `test-main` (or any non-`"main"` literal) unless
//! they intentionally test bootstrap behaviour. The literal `"main"`
//! is a specific window label, not a generic identifier; using it in
//! tests creates the impression that the bootstrap window is special-
//! cased when the IPC routing actually uses `window.label()` at
//! runtime.
//!
//! Self-tests at the bottom guard the matcher itself so a future edit
//! that breaks the recognizer cannot silently let the gate pass empty.

use std::fs;
use std::path::{Path, PathBuf};

/// (file_relative_to_src_tauri, substring_on_the_line)
const ALLOW: &[(&str, &str)] = &[
    // lib.rs::build_main_window — bootstrap main-window builder (PR #318).
    ("src/lib.rs", "tauri::WebviewWindowBuilder::new(handle, \"main\""),
    ("src/lib.rs", "build_window_menu(handle, \"main\")"),
    // lib.rs::setup — bootstrap main-window registration (folder + file-only).
    ("src/lib.rs", "reg.register(\"main\".to_string(), registry::WindowKind::Folder"),
    ("src/lib.rs", "reg.register(\"main\".to_string(), registry::WindowKind::FileOnly"),
    // lib.rs::setup — push initial launch args into the bootstrap window queue.
    ("src/lib.rs", "reg.push_args(\"main\", main_args)"),
    // lib.rs::setup — fetch + install bootstrap window menu.
    ("src/lib.rs", "app.get_webview_window(\"main\")"),
    ("src/lib.rs", "build_window_menu(app, \"main\")"),
    // lib.rs::run — RunEvent::Reopen on macOS focuses the bootstrap window if visible.
    ("src/lib.rs", ".get(\"main\")"),
    // commands/launch.rs::set_root_via_test (debug-only e2e helper).
    ("src/commands/launch.rs", "reg.push_args(\"main\", launch_args)"),
    ("src/commands/launch.rs", "app.emit_to(\"main\", \"args-received\", ())"),
    ("src/commands/launch.rs", "app.get_webview_window(\"main\")"),
    // commands/launch.rs::set_root_via_test — bootstrap asset-scope + watcher
    // seed for the e2e helper window. Issue #338 / iter-1 forward-fix.
    ("src/commands/launch.rs", "crate::window_scope::extend_window_scope(&app, \"main\","),
    // lib.rs::setup — bootstrap window_scope chokepoint extension. Issue
    // #338 / iter-1 forward-fix: every WindowRegistry::register site routes
    // through window_scope::extend_window_scope so the asset-protocol scope
    // and tree_watched_dirs are seeded synchronously.
    ("src/lib.rs", "window_scope::extend_window_scope(app.handle(), \"main\","),
    // menu.rs::menu_event_delivery — `menu-check-updates` always targets
    // the main window because the updater backend is process-global and
    // the UpdateBanner only mounts in main. See rule
    // `multiwin-window-scoped-events` in v2-patterns.md.
    ("src/menu.rs", "\"menu-check-updates\" => MenuEventDelivery::Targeted(\"main\")"),
    // lib.rs::tests — unit tests for menu-id encoders pass `"main"` as a
    // synthetic window label to pure functions. The literal is the input
    // to the test, not a hardcoded runtime call site.
    ("src/lib.rs", "encode_menu_id(\"main\", \"open-file\")"),
    ("src/lib.rs", "parse_menu_id(\"main:open-file\")"),
];

/// Files allowed to use the literal `"main"` freely. This list is
/// deliberately narrow — only files that own the bootstrap label as
/// part of their public API qualify. `src/registry.rs` is the canonical
/// example: it mints `"main"` for the bootstrap window. New Rust tests
/// should use synthetic labels (e.g. `test-main`); they are NOT
/// covered by this list. To grant a true bootstrap-behaviour test
/// access to the literal, add an explicit pair to `ALLOW` above with
/// the file path + the exact line substring.
const ALLOW_FILES: &[&str] = &[
    "src/registry.rs",
];

fn walk_rs_files(root: &Path, out: &mut Vec<PathBuf>) {
    if let Ok(entries) = fs::read_dir(root) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_dir() {
                let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
                if matches!(name, "target" | ".git") {
                    continue;
                }
                walk_rs_files(&p, out);
            } else if p.extension().and_then(|e| e.to_str()) == Some("rs") {
                out.push(p);
            }
        }
    }
}

/// True if `line` contains the bare `"main"` 6-character token (open
/// quote, m, a, i, n, close quote) — but NOT a longer string with
/// `main` as a substring (e.g. `"main_window"` or `"--main-arg"`).
///
/// Detection scans each occurrence of the literal `"main"` and verifies
/// the next character (if any) is NOT alphanumeric/underscore/dash.
/// (The opening `"` already separates `main` from any preceding token,
/// so we only need to check the trailing boundary.)
///
/// Skips:
///   * line comments (`//`, `///`, `//!`)
///   * block-comment continuations (`*`-indented rustdoc lines)
fn line_has_main_literal(line: &str) -> bool {
    let trimmed = line.trim_start();
    if trimmed.starts_with("//") || trimmed.starts_with("/*") || trimmed.starts_with("*") {
        return false;
    }
    let needle = "\"main\"";
    let mut search = line;
    while let Some(idx) = search.find(needle) {
        // The character AFTER the closing `"`. If we're at the end of
        // the line, treat as end-of-input (matches).
        let after_idx = idx + needle.len();
        let next = search.as_bytes().get(after_idx).copied();
        let is_extension = matches!(next, Some(c) if (c as char).is_alphanumeric() || c == b'_' || c == b'-');
        if !is_extension {
            return true;
        }
        // Skip past this occurrence and keep searching.
        search = &search[after_idx..];
    }
    false
}

#[test]
fn no_hardcoded_main_label_outside_allowlist() {
    let crate_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let src = crate_root.join("src");
    let mut files = Vec::new();
    walk_rs_files(&src, &mut files);

    let mut violations = Vec::new();
    for path in &files {
        let content = match fs::read_to_string(path) {
            Ok(c) => c,
            Err(_) => continue,
        };
        let rel = path
            .strip_prefix(&crate_root)
            .unwrap()
            .to_string_lossy()
            .replace('\\', "/");
        if ALLOW_FILES.iter().any(|f| rel == *f) {
            continue;
        }
        for (line_idx, line) in content.lines().enumerate() {
            if !line_has_main_literal(line) {
                continue;
            }
            let allowed = ALLOW
                .iter()
                .any(|(p, s)| rel == *p && line.contains(s));
            if allowed {
                continue;
            }
            violations.push(format!("{}:{} — {}", rel, line_idx + 1, line.trim()));
        }
    }
    assert!(
        violations.is_empty(),
        "Hardcoded \"main\" window-label literal outside allowlist. \
         Derive the label from context (window.label(), registry lookups, menu-id encoding). \
         See docs/best-practices-common/tauri/v2-patterns.md rule multiwin-no-hardcoded-label.\n  {}",
        violations.join("\n  ")
    );
}

// ── Matcher self-tests ──────────────────────────────────────────────────
// Guard the recognizer itself.

#[test]
fn matcher_flags_bare_main_literal() {
    // Positive: bare `"main"` token must be flagged.
    let line = "let win = app.get_webview_window(\"main\");";
    assert!(line_has_main_literal(line));
}

#[test]
fn matcher_flags_main_at_end_of_line() {
    // Positive: literal at end of line (no trailing char) must be flagged.
    let line = "    .get(\"main\")";
    assert!(line_has_main_literal(line));
}

#[test]
fn matcher_flags_main_in_synthetic_rust_test_line() {
    // A line that could appear inside a `#[cfg(test)]` block in
    // `watcher_tests.rs` or any `tests/` integration crate. The matcher
    // does NOT have a "test code is exempt" carve-out — exemption is
    // controlled by `ALLOW` and `ALLOW_FILES`. A new test author who
    // assumes test code is broadly exempt (per a misreading of the
    // crate-level docstring before this fix) would be surprised when
    // CI rejects this line.
    //
    // This test guards against future docstring drift: if anyone tries
    // to make `#[cfg(test)]` a runtime-recognised exemption category
    // (rather than the file-level ALLOW_FILES allowlist), this test
    // would need to update — making the change visible to reviewers.
    let line = "    state.seed_window_workspace(\"main\", vec![canonical.clone()]);";
    assert!(
        line_has_main_literal(line),
        "matcher must flag synthetic test code containing the literal \"main\""
    );
}

#[test]
fn matcher_does_not_flag_main_window_substring() {
    // Negative: `"main_window"` is a longer literal — `main` is just a
    // substring, not the whole token. Must NOT match.
    let line = "let label = \"main_window\";";
    assert!(!line_has_main_literal(line));
}

#[test]
fn matcher_does_not_flag_main_dash_arg() {
    // Negative: `"--main-arg"` likewise.
    let line = "let arg = \"--main-arg\";";
    assert!(!line_has_main_literal(line));
}

#[test]
fn matcher_does_not_flag_mainnnn() {
    // Negative: `"mainnnn"` (no quote-as-boundary) must NOT match.
    let line = "let s = \"mainnnn\";";
    assert!(!line_has_main_literal(line));
}

#[test]
fn matcher_skips_line_comment() {
    // Negative: a comment with `"main"` is not a call site.
    let line = "    // bootstrap label is \"main\"";
    assert!(!line_has_main_literal(line));
}

#[test]
fn matcher_skips_doc_comment() {
    // Negative: rustdoc comment.
    let line = "/// returns the \"main\" window if registered";
    assert!(!line_has_main_literal(line));
}

#[test]
fn matcher_skips_block_comment_continuation() {
    // Negative: `*`-continuation inside `/** ... */`.
    let line = " * The bootstrap window is labelled \"main\".";
    assert!(!line_has_main_literal(line));
}
