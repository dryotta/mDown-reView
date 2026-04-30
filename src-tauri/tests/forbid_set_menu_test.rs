//! Forbid `app.set_menu()` (and any `*.set_menu(`) calls outside the
//! bootstrap allowlist.
//!
//! Per docs/best-practices-common/tauri/v2-patterns.md rule
//! `multiwin-per-window-menu`: secondary windows must use
//! `WebviewWindowBuilder::menu(...)` so each window's menu bar is built
//! before the window first paints. Only the bootstrap main window may
//! use `set_menu` post-build (the `app.set_menu` macOS path and the
//! `main_win.set_menu` non-macOS fallback in `lib.rs::setup`) until the
//! bootstrap-window-via-code migration in issue #315's C-section lands.
//!
//! Self-tests at the bottom guard the matcher itself so a future edit
//! that breaks the regex cannot silently let the gate pass empty.

use std::fs;
use std::path::{Path, PathBuf};

/// (file_relative_to_src_tauri, substring_on_the_line)
///
/// Allowlist entries are matched by `(rel_path, substring)` (NOT by line
/// number) so legitimate sites can move within a file without churning
/// this list. Adding entries here requires reviewer sign-off — every
/// new `set_menu` outside `WebviewWindowBuilder::menu` is presumed
/// wrong.
const ALLOW: &[(&str, &str)] = &[
    // lib.rs::setup — bootstrap main window menu install.
    // macOS path uses `app.set_menu` because Window::set_menu is
    // documented as Unsupported on macOS (see lib.rs comment at the
    // call site).
    ("src/lib.rs", "app.set_menu(main_menu)"),
    // lib.rs::setup — non-macOS path: per-window menu install for the
    // bootstrap "main" window. Non-bootstrap windows must use
    // `WebviewWindowBuilder::menu` (see `create_app_window`).
    ("src/lib.rs", "main_win.set_menu(main_menu)"),
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

/// True if `line` should be flagged as a `set_menu` call site.
///
/// Skips:
///   * line comments (`//`, `///`, `//!`)
///   * block-comment continuations (`*` indent prefix in rustdoc)
///   * function definitions (`fn set_menu(...)`)
///
/// Matches `set_menu(` anywhere on the line so it catches
/// `app.set_menu`, `main_win.set_menu`, `AppHandle::set_menu`, etc.
fn line_is_set_menu_call(line: &str) -> bool {
    let trimmed = line.trim_start();
    if trimmed.starts_with("//") || trimmed.starts_with("/*") || trimmed.starts_with("*") {
        return false;
    }
    if !line.contains("set_menu(") {
        return false;
    }
    if trimmed.starts_with("fn set_menu") || line.contains(" fn set_menu") {
        return false;
    }
    true
}

#[test]
fn no_set_menu_outside_allowlist() {
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
        for (line_idx, line) in content.lines().enumerate() {
            if !line_is_set_menu_call(line) {
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
        "set_menu calls outside allowlist (use WebviewWindowBuilder::menu() instead). \
         See docs/best-practices-common/tauri/v2-patterns.md rule multiwin-per-window-menu.\n  {}",
        violations.join("\n  ")
    );
}

// ── Matcher self-tests ──────────────────────────────────────────────────
// Guard the matcher logic itself so a future edit that breaks the regex
// cannot silently let `no_set_menu_outside_allowlist` pass empty.

#[test]
fn matcher_flags_unallowlisted_call() {
    // Positive: a bare set_menu invocation must be flagged.
    let line = "    let _ = app.set_menu(menu);";
    assert!(line_is_set_menu_call(line));
}

#[test]
fn matcher_flags_method_call_on_window() {
    // Positive: `win.set_menu(...)` must also be flagged regardless of
    // receiver name. Catches the "create a fresh window then call
    // set_menu after the fact" anti-pattern that motivated the rule.
    let line = "    win.set_menu(menu)?;";
    assert!(line_is_set_menu_call(line));
}

#[test]
fn matcher_skips_function_definition() {
    // Negative: defining `fn set_menu` is not a call site.
    let line = "fn set_menu(handle: &AppHandle) {";
    assert!(!line_is_set_menu_call(line));
}

#[test]
fn matcher_skips_line_comment() {
    // Negative: a comment mentioning set_menu is not a call site.
    let line = "    // app.set_menu(menu) is forbidden here";
    assert!(!line_is_set_menu_call(line));
}

#[test]
fn matcher_skips_doc_comment() {
    // Negative: a rustdoc line mentioning set_menu is not a call site.
    let line = "/// `app.set_menu(menu)` is the bootstrap path on macOS.";
    assert!(!line_is_set_menu_call(line));
}

#[test]
fn matcher_skips_block_comment_continuation() {
    // Negative: `*` continuation lines inside `/** ... */`.
    let line = " * See `app.set_menu(menu)` for the bootstrap path.";
    assert!(!line_is_set_menu_call(line));
}
