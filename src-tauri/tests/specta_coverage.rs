//! Meta-test for the tauri-specta codegen pipeline (issue #263).
//!
//! Walks `src-tauri/src/`, parses every `.rs` file with `syn`, and
//! asserts that every function carrying `#[tauri::command]` ALSO
//! carries `#[specta::specta]` (so `tauri_specta::collect_commands![]`
//! finds it). Functions in `EXEMPT_FNS` are skipped — these are
//! commands intentionally left out of the specta builder because their
//! signatures cannot be described by specta (e.g. binary-IPC
//! `tauri::ipc::Response` return). Adding a new exemption requires
//! updating both this list AND `lib.rs::build_specta_builder` AND the
//! dispatcher in `lib.rs::run`.
//!
//! This file deliberately does NOT reference any `mdown_review_lib::*`
//! symbol that pulls in `tauri::Wry` (and therefore `tauri-runtime-wry`
//! and `webview2`). On some Windows dev hosts the test binary fails to
//! load with `STATUS_ENTRYPOINT_NOT_FOUND` (0xC0000139) when those are
//! linked in. Bindings regeneration lives in `tests/specta_codegen.rs`
//! and is `#[cfg_attr(target_os = "windows", ignore = ...)]` for the
//! same reason — see that file for the rationale and CI strategy.

use std::path::{Path, PathBuf};
use syn::visit::Visit;

/// Functions that intentionally do NOT carry `#[specta::specta]`.
/// Their signatures use types that specta cannot describe (e.g.
/// `tauri::ipc::Response` for binary IPC). They are registered via the
/// merge dispatcher in `lib.rs::run` (legacy `tauri::generate_handler!`).
const EXEMPT_FNS: &[&str] = &["fetch_remote_asset"];

/// Recursively collect every `.rs` file under `dir`.
fn rs_files(dir: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return out,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            out.extend(rs_files(&path));
        } else if path.extension().is_some_and(|e| e == "rs") {
            out.push(path);
        }
    }
    out
}

/// True if the attribute path's segments end in any of `targets` (so
/// `#[tauri::command]`, `#[command]`, and `#[crate::tauri::command]`
/// all match `["tauri::command", "command"]`). This keeps the meta-test
/// resilient against `use ... as ...` / re-exports without requiring
/// full name resolution.
fn attr_path_matches(attr: &syn::Attribute, targets: &[&[&str]]) -> bool {
    let segs: Vec<String> = attr
        .path()
        .segments
        .iter()
        .map(|s| s.ident.to_string())
        .collect();
    for target in targets {
        if segs.len() < target.len() {
            continue;
        }
        let tail = &segs[segs.len() - target.len()..];
        if tail.iter().zip(target.iter()).all(|(a, b)| a == b) {
            return true;
        }
    }
    false
}

struct CommandVisitor {
    file: PathBuf,
    /// Functions found that have `#[tauri::command]` but no `#[specta::specta]`.
    missing: Vec<(PathBuf, String)>,
}

impl<'ast> Visit<'ast> for CommandVisitor {
    fn visit_item_fn(&mut self, item: &'ast syn::ItemFn) {
        let has_tauri_cmd = item
            .attrs
            .iter()
            .any(|a| attr_path_matches(a, &[&["tauri", "command"], &["command"]]));
        if !has_tauri_cmd {
            syn::visit::visit_item_fn(self, item);
            return;
        }
        let fn_name = item.sig.ident.to_string();
        if EXEMPT_FNS.contains(&fn_name.as_str()) {
            syn::visit::visit_item_fn(self, item);
            return;
        }
        let has_specta = item
            .attrs
            .iter()
            .any(|a| attr_path_matches(a, &[&["specta", "specta"], &["specta"]]));
        if !has_specta {
            self.missing.push((self.file.clone(), fn_name));
        }
        syn::visit::visit_item_fn(self, item);
    }
}

#[test]
fn every_tauri_command_has_specta_specta() {
    let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    let src_dir = manifest_dir.join("src");
    let files = rs_files(&src_dir);
    assert!(
        !files.is_empty(),
        "no .rs files found under {} — test setup is wrong",
        src_dir.display()
    );

    let mut all_missing: Vec<(PathBuf, String)> = Vec::new();
    for file in &files {
        let src = std::fs::read_to_string(file)
            .unwrap_or_else(|e| panic!("read {}: {e}", file.display()));
        let ast = match syn::parse_file(&src) {
            Ok(a) => a,
            // Skip files with parse errors (some test fixtures contain
            // intentionally malformed code). Real production code parses
            // cleanly; if a real file ever fails, the build catches it.
            Err(_) => continue,
        };
        let mut visitor = CommandVisitor {
            file: file.clone(),
            missing: Vec::new(),
        };
        visitor.visit_file(&ast);
        all_missing.extend(visitor.missing);
    }

    assert!(
        all_missing.is_empty(),
        "the following `#[tauri::command]` fns are missing `#[specta::specta]` \
         (add the attribute or extend EXEMPT_FNS in tests/specta_coverage.rs): {:#?}",
        all_missing
    );
}
