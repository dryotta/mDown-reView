//! Window-arg presence lint for `#[mdr_command]` / `#[tauri::command]`
//! handlers.
//!
//! Per docs/best-practices-common/tauri/v2-patterns.md rule
//! `multiwin-renderer-window-context` (and its companion
//! `multiwin-state-isolation` / `multiwin-allowlist-scope`): commands
//! that mutate per-window state MUST take a `window: tauri::Window`
//! (or `window: tauri::WebviewWindow`) parameter so the IPC handler
//! can scope its writes to the calling window's label rather than
//! reaching across the registry.
//!
//! Two classes of commands are exempt:
//!   1. **Process-global** — IPCs that read or mutate state shared by
//!      the whole app (e.g. `record_startup_phase`, `get_log_path`,
//!      author / config files in `app_config_dir`). These cannot
//!      meaningfully scope to a single window.
//!   2. **Pure / file-scoped** — IPCs whose argument list IS the
//!      scope (e.g. `read_text_file(path)`, `tokenize_words(text)`,
//!      `parse_kql(query)`). The `window` arg would be unused.
//!
//! Every other command (per-window allowlist mutation, per-window
//! comment / sidecar / file-viewer-pref mutation, registry
//! mutation) MUST take a window arg. The macro lint catches the case
//! where a future PR adds a per-window IPC and forgets the
//! parameter; the renderer would then be unable to thread its label
//! and the Rust side would fall back to a global side-effect.
//!
//! Output format on failure mirrors the other meta-tests in this
//! directory:
//!   `path:line — function_name LACKS window arg (per-window-state mutation)`
//!
//! Self-tests at the bottom guard the recogniser itself so a future
//! edit cannot silently let the gate pass empty.

use std::fs;
use std::path::{Path, PathBuf};

/// Commands that are EXEMPT from the window-arg requirement. Each entry
/// is the bare function name (the Rust identifier — same string the
/// frontend passes to `invoke()`). Membership in this list is a
/// deliberate architectural statement: "this IPC has no per-window
/// scope and therefore needs no per-window identity".
///
/// New entries require a one-line justification comment.
const EXEMPT_COMMANDS: &[&str] = &[
    // Process-global: writes to `app_log_dir` shared by every window.
    "get_log_path",
    // Pure: input is the scope.
    "read_text_file",
    "read_binary_file",
    "stat_file",
    "check_path_exists",
    "canonicalize_path",
    "read_dir",
    "scan_review_files",
    "tokenize_words",
    "search_in_document",
    "parse_kql",
    "strip_json_comments",
    "compute_anchor_hash",
    "compute_fold_regions",
    "resolve_html_assets",
    "fetch_remote_asset",
    // Process-global startup recorder.
    "record_startup_phase",
    // Process-global config in app_config_dir (author / preferences).
    "set_author",
    "get_author",
    // Process-global onboarding state in app_config_dir.
    "onboarding_state",
    // Process-global OS shell integration (CLI shim install/status/remove).
    "cli_shim_status",
    "install_cli_shim",
    "remove_cli_shim",
    // Process-global default-handler status (registry / Launch Services).
    "default_handler_status",
    "set_default_handler",
    // app: AppHandle is sufficient — the OS shell open is process-scoped.
    "reveal_in_folder",
    // Reads from app_config_dir; preference applies to every window.
    "get_file_viewer_pref",
    "set_file_viewer_pref",
    // Reads-only of the per-app sidecar config; scope is the workspace
    // root (provided as an argument), not the calling window's label.
    "get_sidecar_config",
    // app: AppHandle is sufficient — Tauri auto-emits to "main"
    // window via PendingUpdate which is process-global.
    "check_update",
    "install_update",
    // Debug-only test seam (gated by `#[cfg(debug_assertions)]`).
    // Hardcodes the bootstrap "main" label deliberately — it is the
    // sole IPC entry point native E2E uses to reseed launch args
    // into the bootstrap window. See `forbid_hardcoded_main_label_test.rs`
    // ALLOW list for the matching debt entries.
    "set_root_via_test",
    // BadgeCache lookups are read-only; cache is keyed by file path,
    // not window. The cache uses the WatcherState path-allowlist for
    // safety so the data it returns is already scope-limited.
    "get_file_badges",
    "get_file_comments",
    // Comment-mutation IPCs: enforce_workspace_path uses the
    // path-allowlist (window-scoped at watcher.rs) to prevent
    // cross-window writes. The `window` arg is not needed because the
    // path itself is the scope unit and the allowlist already filters.
    "add_comment",
    "add_reply",
    "edit_comment",
    "update_comment",
    "delete_comment",
];

/// Per-window-state-mutating commands that MUST take a `window: tauri::Window`
/// (or `WebviewWindow`) arg. Listed explicitly so the lint can fail loudly
/// if any of them ever loses the parameter; presence is asserted in
/// addition to the global requirement.
const MUST_HAVE_WINDOW: &[&str] = &[
    "get_launch_args",
    "register_window_folder",
    "unregister_window_folder",
    "set_sidecar_config",
    "update_watched_files",
    "update_tree_watched_dirs",
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

/// True if `attr_line` is one of the IPC-registration attributes.
/// Both `#[mdr_command]` and the bare `#[tauri::command]` count.
fn is_command_attr(line: &str) -> bool {
    let t = line.trim_start();
    t.starts_with("#[mdr_command]")
        || t.starts_with("#[mdr_command(")
        || t.starts_with("#[tauri::command]")
        || t.starts_with("#[tauri::command(")
}

/// Skip a line that is purely an attribute, blank, comment, or doc
/// comment. Returns true when the line is "interesting" — i.e. we
/// expect it to be the function signature.
fn is_signature_candidate(line: &str) -> bool {
    let t = line.trim_start();
    if t.is_empty() {
        return false;
    }
    if t.starts_with("//") || t.starts_with("/*") || t.starts_with("*") {
        return false;
    }
    if t.starts_with('#') {
        // Another attribute (e.g. #[allow(...)]).
        return false;
    }
    true
}

/// Extract the function name from a `pub fn foo<…>(` / `pub async fn foo(`
/// signature line. Returns `None` if the line does not look like a
/// function signature.
fn parse_fn_name(line: &str) -> Option<String> {
    // Find the `fn ` token. Require a space or tab after to avoid
    // matching `fnord`.
    let idx = line.find("fn ").or_else(|| line.find("fn\t"))?;
    let after = &line[idx + 3..];
    // Function name = identifier characters until `(`, `<`, ` `, or `:`.
    let name: String = after
        .chars()
        .take_while(|c| c.is_alphanumeric() || *c == '_')
        .collect();
    if name.is_empty() {
        None
    } else {
        Some(name)
    }
}

/// True if the multi-line signature `block` declares a `window:
/// tauri::Window` (or `WebviewWindow`) parameter. The block is the
/// joined text from the `pub fn` line through the closing `)` of the
/// argument list.
fn has_window_arg(block: &str) -> bool {
    // We accept either `window: tauri::Window` or `tauri::WebviewWindow`.
    // The token must appear on a line that is part of the parameter
    // list — but since we collected exactly that block, any occurrence
    // of `tauri::Window` or `tauri::WebviewWindow` after a `window:`
    // is sufficient.
    if !block.contains("window:") {
        return false;
    }
    block.contains("tauri::Window") || block.contains("tauri::WebviewWindow")
}

/// Read the function-signature block starting at `start_line` in
/// `lines`. Joins lines until a `)` closes the argument list (matched
/// against parentheses depth so nested generics don't confuse us).
fn read_signature_block(lines: &[&str], start_line: usize) -> String {
    let mut out = String::new();
    let mut depth: i32 = 0;
    let mut seen_open = false;
    for line in lines.iter().skip(start_line) {
        out.push_str(line);
        out.push('\n');
        for c in line.chars() {
            match c {
                '(' => {
                    depth += 1;
                    seen_open = true;
                }
                ')' => depth -= 1,
                _ => {}
            }
        }
        if seen_open && depth == 0 {
            break;
        }
    }
    out
}

#[test]
fn ipc_commands_take_window_arg_or_are_explicitly_exempt() {
    let crate_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let src = crate_root.join("src");
    let mut files = Vec::new();
    walk_rs_files(&src, &mut files);

    let mut violations: Vec<String> = Vec::new();
    let mut found_must_have: Vec<String> = Vec::new();

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
        let lines: Vec<&str> = content.lines().collect();

        for (i, line) in lines.iter().enumerate() {
            if !is_command_attr(line) {
                continue;
            }
            // Walk forward to the first signature candidate.
            let mut j = i + 1;
            while j < lines.len() && !is_signature_candidate(lines[j]) {
                j += 1;
            }
            if j >= lines.len() {
                continue;
            }
            let block = read_signature_block(&lines, j);
            let name = match parse_fn_name(lines[j]) {
                Some(n) => n,
                None => continue,
            };
            let has_win = has_window_arg(&block);

            if MUST_HAVE_WINDOW.contains(&name.as_str()) {
                if !has_win {
                    violations.push(format!(
                        "{}:{} — {} LACKS window arg (must-have-window list)",
                        rel,
                        j + 1,
                        name
                    ));
                } else {
                    found_must_have.push(name.clone());
                }
                continue;
            }

            if EXEMPT_COMMANDS.contains(&name.as_str()) {
                continue;
            }

            if !has_win {
                violations.push(format!(
                    "{}:{} — {} LACKS window arg (per-window-state mutation). \
                     Add `window: tauri::Window` or list the command in EXEMPT_COMMANDS \
                     with a justification comment.",
                    rel,
                    j + 1,
                    name
                ));
            }
        }
    }

    // Every entry in MUST_HAVE_WINDOW that we expected to see should
    // have been encountered at least once. A missing entry means the
    // command was renamed or deleted; either way, the lint should
    // be told so a stale must-have list cannot drift silently.
    let mut missing_must_have: Vec<&&str> = MUST_HAVE_WINDOW
        .iter()
        .filter(|name| !found_must_have.iter().any(|f| f == *name))
        .collect();
    missing_must_have.sort();

    assert!(
        violations.is_empty() && missing_must_have.is_empty(),
        "Window-arg lint failures (rule multiwin-renderer-window-context in \
         docs/best-practices-common/tauri/v2-patterns.md):\n  {}\n\
         missing-from-source MUST_HAVE_WINDOW commands (delete from list or restore the IPC):\n  {}",
        violations.join("\n  "),
        missing_must_have
            .iter()
            .map(|s| s.to_string())
            .collect::<Vec<_>>()
            .join("\n  "),
    );
}

// ── Recogniser self-tests ──────────────────────────────────────────────

#[test]
fn matcher_recognises_mdr_command_attr() {
    assert!(is_command_attr("#[mdr_command]"));
    assert!(is_command_attr("    #[mdr_command]"));
    assert!(is_command_attr("#[mdr_command(rename_all = \"camelCase\")]"));
}

#[test]
fn matcher_recognises_tauri_command_attr() {
    assert!(is_command_attr("#[tauri::command]"));
    assert!(is_command_attr("#[tauri::command(rename_all = \"camelCase\")]"));
}

#[test]
fn matcher_does_not_recognise_unrelated_attr() {
    assert!(!is_command_attr("#[allow(dead_code)]"));
    assert!(!is_command_attr("#[derive(Debug)]"));
    assert!(!is_command_attr("// #[mdr_command]"));
}

#[test]
fn signature_candidate_skips_attrs_and_comments() {
    assert!(!is_signature_candidate(""));
    assert!(!is_signature_candidate("    "));
    assert!(!is_signature_candidate("// a comment"));
    assert!(!is_signature_candidate("/// a doc comment"));
    assert!(!is_signature_candidate(" * block-comment line"));
    assert!(!is_signature_candidate("#[allow(dead_code)]"));
    assert!(is_signature_candidate("pub fn foo() {}"));
    assert!(is_signature_candidate("pub async fn bar("));
}

#[test]
fn fn_name_parsing_handles_generics_and_async() {
    assert_eq!(parse_fn_name("pub fn foo() {}").as_deref(), Some("foo"));
    assert_eq!(
        parse_fn_name("pub async fn bar(").as_deref(),
        Some("bar")
    );
    assert_eq!(
        parse_fn_name("pub fn add_comment<R: Runtime>(").as_deref(),
        Some("add_comment")
    );
    // Not a function signature.
    assert_eq!(parse_fn_name("let x = 1;"), None);
    // `fnord` must not be parsed as `fn`.
    assert_eq!(parse_fn_name("fnord"), None);
}

#[test]
fn window_arg_detector_flags_window_param() {
    let block = "pub fn foo(window: tauri::Window, x: String) -> Result<(), String> {";
    assert!(has_window_arg(block));
    let block_webview = "pub fn foo(window: tauri::WebviewWindow) {";
    assert!(has_window_arg(block_webview));
    let block_multiline = "pub fn foo(\n    window: tauri::Window,\n    x: String,\n)";
    assert!(has_window_arg(block_multiline));
}

#[test]
fn window_arg_detector_does_not_flag_state_only() {
    let block = "pub fn foo(state: State<'_, WatcherState>, path: String) -> () {";
    assert!(!has_window_arg(block));
}

#[test]
fn window_arg_detector_does_not_flag_app_handle_only() {
    // AppHandle is process-scoped, NOT per-window.
    let block = "pub fn foo(app: AppHandle, x: String) -> () {";
    assert!(!has_window_arg(block));
    let block_qualified = "pub fn foo(app: tauri::AppHandle, x: String) -> () {";
    assert!(!has_window_arg(block_qualified));
}

#[test]
fn signature_block_balances_parens() {
    let lines = [
        "pub fn complex(",
        "    a: Vec<(String, Vec<u8>)>,",
        "    window: tauri::Window,",
        ") -> Result<(), String> {",
        "    body",
        "}",
    ];
    let block = read_signature_block(&lines, 0);
    // Block stops at the line with the closing `)` BEFORE the body.
    assert!(block.contains("window: tauri::Window"));
    assert!(!block.contains("body"));
}
