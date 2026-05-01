//! Forbid iteration over `app.webview_windows()` outside `src/registry.rs`.
//!
//! Per docs/best-practices-common/tauri/v2-patterns.md rule
//! `multiwin-lifecycle-registry`: iterating the runtime
//! window map (`app.webview_windows().{values, iter, keys, into_iter}()`)
//! produces N×N noise — every consumer that loops gets every window
//! regardless of relevance. Routing through `WindowRegistry` lookups
//! (`find_by_folder`, `find_ancestor_folder`, etc.) lets each consumer
//! ask the question they actually care about (which window owns this
//! folder?) instead of filtering after the fact.
//!
//! `src/registry.rs` is the canonical iteration site and is fully
//! allowlisted. Other files may use `app.get_webview_window(label)`
//! (single-window lookup), but loops over the whole map require an
//! explicit allowlist entry below.
//!
//! Self-tests at the bottom guard the matcher itself.

use std::fs;
use std::path::{Path, PathBuf};

/// File paths (relative to `src-tauri/`) where ANY iteration over
/// `webview_windows()` is permitted. `registry.rs` is the canonical
/// owner of window iteration; anywhere else is a smell.
const ALLOW_FILES: &[&str] = &[
    "src/registry.rs",
];

/// (file, substring) pairs for known violations that the C-section of
/// issue #315 will migrate to `WindowRegistry` queries. Each entry is
/// a debt marker — when the migration lands the entry is removed and
/// the gate enforces the new shape.
const ALLOW_LINES: &[(&str, &str)] = &[
    // TODO: removed by issue #315 Medium-section win-bring-all + lifecycle handlers fix — `win-bring-all` macOS menu
    // handler in lib.rs::on_menu_event. Should consult the registry
    // instead of iterating the runtime map.
    ("src/lib.rs", "for w in app.webview_windows().values()"),
    // TODO: removed by issue #315 Medium-section win-bring-all + lifecycle handlers fix — macOS CloseRequested
    // last-visible-window check in lib.rs::on_window_event.
    ("src/lib.rs", ".webview_windows()"),
    // TODO: removed by issue #315 Medium-section win-bring-all + lifecycle handlers fix — RunEvent::Reopen on macOS
    // re-shows hidden windows in lib.rs::run.
    ("src/lib.rs", "app_handle.webview_windows()"),
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

/// True if `line` calls `webview_windows()` followed (with optional
/// whitespace) by `.values(`, `.iter(`, `.keys(`, or `.into_iter(`.
///
/// Skips:
///   * line comments (`//`, `///`, `//!`)
///   * block-comment continuations (`*` rustdoc lines)
///
/// Note: This recognizer also catches the bare `webview_windows()` form
/// when followed by `.method(` on the same line. The known
/// multi-line `.webview_windows()` chain (in lib.rs's macOS
/// CloseRequested handler) is allow-listed by `(file, ".webview_windows()")`
/// because the iteration intent IS on this line.
fn line_iterates_webview_windows(line: &str) -> bool {
    let trimmed = line.trim_start();
    if trimmed.starts_with("//") || trimmed.starts_with("/*") || trimmed.starts_with("*") {
        return false;
    }
    if !line.contains("webview_windows()") {
        return false;
    }
    // Look for any of the iterator-producing methods.
    for method in [".values(", ".iter(", ".keys(", ".into_iter("] {
        if line.contains(method) {
            return true;
        }
    }
    // Multi-line chains: a single line that contains `.webview_windows()` at
    // its start (after trim) is the chain anchor; flag it so the allowlist
    // can claim or call it out.
    if trimmed.starts_with(".webview_windows()") {
        return true;
    }
    // The `let windows = app_handle.webview_windows();` shape stores the
    // map for later iteration — also flag.
    if line.contains("= ") && line.contains("webview_windows()") {
        return true;
    }
    false
}

#[test]
fn no_webview_windows_iteration_outside_allowlist() {
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
            if !line_iterates_webview_windows(line) {
                continue;
            }
            let allowed = ALLOW_LINES
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
        "Iteration over `app.webview_windows()` outside the registry. \
         Use `WindowRegistry::find_by_folder` / `find_ancestor_folder` / `find_file_only`. \
         See docs/best-practices-common/tauri/v2-patterns.md rule multiwin-lifecycle-registry.\n  {}",
        violations.join("\n  ")
    );
}

// ── Matcher self-tests ──────────────────────────────────────────────────

#[test]
fn matcher_flags_values_iteration() {
    // Positive: `app.webview_windows().values()` is the canonical
    // smell from PR #304's bug B.
    let line = "    for w in app.webview_windows().values() {";
    assert!(line_iterates_webview_windows(line));
}

#[test]
fn matcher_flags_iter_iteration() {
    // Positive: `.iter()` over the map.
    let line = "    let focused = app.webview_windows().iter().find(|(_, w)| ...);";
    assert!(line_iterates_webview_windows(line));
}

#[test]
fn matcher_flags_let_binding() {
    // Positive: `let windows = app_handle.webview_windows();` stores
    // the map for subsequent iteration — also a smell.
    let line = "    let windows = app_handle.webview_windows();";
    assert!(line_iterates_webview_windows(line));
}

#[test]
fn matcher_does_not_flag_get_webview_window_singular() {
    // Negative: `get_webview_window(label)` is the explicit
    // single-window lookup — exactly what consumers should use.
    let line = "    let win = app.get_webview_window(\"main\");";
    assert!(!line_iterates_webview_windows(line));
}

#[test]
fn matcher_skips_line_comment() {
    // Negative: a comment mentioning the smell is not the smell.
    let line = "    // FLAKE-1: avoid app.webview_windows().values()";
    assert!(!line_iterates_webview_windows(line));
}

#[test]
fn matcher_skips_doc_comment() {
    // Negative: rustdoc.
    let line = "/// previous impl iterated `app.webview_windows().values()`";
    assert!(!line_iterates_webview_windows(line));
}

#[test]
fn matcher_skips_block_comment_continuation() {
    // Negative: `*`-continuation inside `/** ... */`.
    let line = " * `app.webview_windows().values()` was the old shape.";
    assert!(!line_iterates_webview_windows(line));
}
