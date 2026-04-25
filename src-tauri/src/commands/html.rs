//! HTML preview helpers: asset inlining and code-fold region computation.

pub use crate::core::fold_regions::FoldRegion;

/// Inline local images as data URIs and stylesheets as `<style>` blocks.
/// Replaces the previous TS implementation in `src/lib/resolve-html-assets.ts`.
/// Per-asset failures preserve the original tag (graceful fallback).
#[tauri::command]
pub fn resolve_html_assets(html: String, html_dir: String) -> String {
    crate::core::html_assets::resolve_local_assets(&html, std::path::Path::new(&html_dir))
}

#[tauri::command]
pub fn compute_fold_regions(content: String, language: String) -> Vec<FoldRegion> {
    crate::core::fold_regions::compute_fold_regions(&content, &language)
}
