use crate::core::types::MrsfSidecar;
use std::path::{Path, PathBuf};

/// Report from a sidecar cleanup pass.
#[derive(Debug, Default, Clone)]
pub struct CleanupReport {
    pub deleted: Vec<PathBuf>,
    pub skipped: Vec<PathBuf>,
}

/// Walk `root` recursively, find `.review.yaml` and `.review.json` sidecars, and
/// delete those whose comments are all resolved (or all sidecars with comments
/// when `include_unresolved` is true). Empty sidecars (no comments) are always
/// preserved. When `dry_run` is true, no files are removed but the report still
/// lists what would have been deleted.
pub fn delete_resolved_sidecars(
    root: &Path,
    include_unresolved: bool,
    dry_run: bool,
) -> std::io::Result<CleanupReport> {
    let mut report = CleanupReport::default();

    let walker = walkdir::WalkDir::new(root)
        .max_depth(50)
        .into_iter()
        .filter_map(|e| e.ok());

    for entry in walker {
        let path = entry.path();
        let name = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n,
            None => continue,
        };
        if !(name.ends_with(".review.yaml") || name.ends_with(".review.json")) {
            continue;
        }

        let path_str = path.to_string_lossy().to_string();
        let sidecar = match load_review_file(&path_str) {
            Ok(s) => s,
            Err(_) => {
                // Unparseable sidecar — preserve it.
                let abs = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
                report.skipped.push(abs);
                continue;
            }
        };

        let should_delete = if sidecar.comments.is_empty() {
            false
        } else if include_unresolved {
            true
        } else {
            sidecar.comments.iter().all(|c| c.resolved)
        };

        let abs = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());

        if should_delete {
            if !dry_run {
                std::fs::remove_file(path)?;
            }
            report.deleted.push(abs);
        } else {
            report.skipped.push(abs);
        }
    }

    Ok(report)
}

/// Walk a directory tree and find MRSF sidecar files.
/// YAML takes priority over JSON when both exist for the same source file.
/// Results are capped at `cap` entries.
/// Returns (sidecar_path, source_file_path) pairs.
pub fn find_review_files(root: &str, cap: usize) -> Vec<(String, String)> {
    let mut results = Vec::new();
    let mut seen_sources = std::collections::HashSet::new();

    let walker = walkdir::WalkDir::new(root)
        .max_depth(50)
        .into_iter()
        .filter_map(|e| e.ok());

    // First pass: collect all YAML sidecars (they have priority)
    let entries: Vec<_> = walker.collect();

    for entry in &entries {
        let path = entry.path();
        if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
            if name.ends_with(".review.yaml") {
                let sidecar = path.to_string_lossy().to_string();
                let source = sidecar.trim_end_matches(".review.yaml").to_string();
                seen_sources.insert(source.clone());
                results.push((sidecar, source));
                if results.len() >= cap {
                    return results;
                }
            }
        }
    }

    // Second pass: collect JSON sidecars only if no YAML exists for that source
    for entry in &entries {
        let path = entry.path();
        if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
            if name.ends_with(".review.json") {
                let sidecar = path.to_string_lossy().to_string();
                let source = sidecar.trim_end_matches(".review.json").to_string();
                if !seen_sources.contains(&source) {
                    seen_sources.insert(source.clone());
                    results.push((sidecar, source));
                    if results.len() >= cap {
                        return results;
                    }
                }
            }
        }
    }

    results
}

/// Load a sidecar given the sidecar file path directly (not the source file path).
/// Detects format from extension.
pub fn load_review_file(sidecar_path: &str) -> Result<MrsfSidecar, String> {
    let content = std::fs::read_to_string(sidecar_path).map_err(|e| e.to_string())?;
    if sidecar_path.ends_with(".review.json") {
        serde_json::from_str(&content).map_err(|e| e.to_string())
    } else {
        serde_yaml_ng::from_str(&content).map_err(|e| e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn write_yaml_sidecar(dir: &std::path::Path, name: &str) {
        let path = dir.join(format!("{}.review.yaml", name));
        std::fs::write(
            &path,
            format!(
                r#"mrsf_version: "1.0"
document: "{}"
comments:
  - id: "c1"
    author: "test"
    timestamp: "2025-01-01T00:00:00Z"
    text: "comment"
    resolved: false
"#,
                name
            ),
        )
        .unwrap();
    }

    fn write_json_sidecar(dir: &std::path::Path, name: &str) {
        let path = dir.join(format!("{}.review.json", name));
        std::fs::write(
            &path,
            format!(
                r#"{{"mrsf_version":"1.0","document":"{}","comments":[{{"id":"c1","author":"test","timestamp":"2025-01-01T00:00:00Z","text":"comment","resolved":false}}]}}"#,
                name
            ),
        )
        .unwrap();
    }

    #[test]
    fn find_yaml_sidecars() {
        let tmp = TempDir::new().unwrap();
        std::fs::write(tmp.path().join("a.md"), "# A").unwrap();
        std::fs::write(tmp.path().join("b.md"), "# B").unwrap();
        write_yaml_sidecar(tmp.path(), "a.md");
        write_yaml_sidecar(tmp.path(), "b.md");

        let results = find_review_files(tmp.path().to_str().unwrap(), 10000);
        assert_eq!(results.len(), 2);
    }

    #[test]
    fn yaml_priority_over_json() {
        let tmp = TempDir::new().unwrap();
        std::fs::write(tmp.path().join("a.md"), "# A").unwrap();
        write_yaml_sidecar(tmp.path(), "a.md");
        write_json_sidecar(tmp.path(), "a.md");

        let results = find_review_files(tmp.path().to_str().unwrap(), 10000);
        assert_eq!(results.len(), 1);
        assert!(results[0].0.ends_with(".review.yaml"));
    }

    #[test]
    fn json_fallback_when_no_yaml() {
        let tmp = TempDir::new().unwrap();
        std::fs::write(tmp.path().join("a.md"), "# A").unwrap();
        write_json_sidecar(tmp.path(), "a.md");

        let results = find_review_files(tmp.path().to_str().unwrap(), 10000);
        assert_eq!(results.len(), 1);
        assert!(results[0].0.ends_with(".review.json"));
    }

    #[test]
    fn respects_cap() {
        let tmp = TempDir::new().unwrap();
        for i in 0..10 {
            let name = format!("file{}.md", i);
            std::fs::write(tmp.path().join(&name), "# Test").unwrap();
            write_yaml_sidecar(tmp.path(), &name);
        }

        let results = find_review_files(tmp.path().to_str().unwrap(), 3);
        assert_eq!(results.len(), 3);
    }

    #[test]
    fn nested_directories() {
        let tmp = TempDir::new().unwrap();
        let sub = tmp.path().join("sub");
        std::fs::create_dir(&sub).unwrap();
        std::fs::write(sub.join("deep.md"), "# Deep").unwrap();
        write_yaml_sidecar(&sub, "deep.md");

        let results = find_review_files(tmp.path().to_str().unwrap(), 10000);
        assert_eq!(results.len(), 1);
    }

    #[test]
    fn empty_directory() {
        let tmp = TempDir::new().unwrap();
        let results = find_review_files(tmp.path().to_str().unwrap(), 10000);
        assert!(results.is_empty());
    }

    // ---- delete_resolved_sidecars tests ----

    fn write_yaml_with(dir: &std::path::Path, name: &str, body: &str) -> std::path::PathBuf {
        let path = dir.join(format!("{}.review.yaml", name));
        std::fs::write(&path, body).unwrap();
        path
    }

    fn write_json_with(dir: &std::path::Path, name: &str, body: &str) -> std::path::PathBuf {
        let path = dir.join(format!("{}.review.json", name));
        std::fs::write(&path, body).unwrap();
        path
    }

    fn yaml_one_comment(doc: &str, resolved: bool) -> String {
        format!(
            r#"mrsf_version: "1.0"
document: "{}"
comments:
  - id: "c1"
    author: "test"
    timestamp: "2025-01-01T00:00:00Z"
    text: "comment"
    resolved: {}
"#,
            doc, resolved
        )
    }

    fn yaml_empty(doc: &str) -> String {
        format!(
            r#"mrsf_version: "1.0"
document: "{}"
comments: []
"#,
            doc
        )
    }

    fn canon(p: &std::path::Path) -> std::path::PathBuf {
        std::fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf())
    }

    #[test]
    fn cleanup_deletes_all_resolved_skips_unresolved() {
        let tmp = TempDir::new().unwrap();
        let resolved = write_yaml_with(tmp.path(), "a.md", &yaml_one_comment("a.md", true));
        let unresolved = write_yaml_with(tmp.path(), "b.md", &yaml_one_comment("b.md", false));
        let resolved_canon = canon(&resolved);
        let unresolved_canon = canon(&unresolved);

        let report = delete_resolved_sidecars(tmp.path(), false, false).unwrap();

        assert_eq!(report.deleted, vec![resolved_canon]);
        assert_eq!(report.skipped, vec![unresolved_canon]);
        assert!(!resolved.exists());
        assert!(unresolved.exists());
    }

    #[test]
    fn cleanup_include_unresolved_deletes_everything_with_comments() {
        let tmp = TempDir::new().unwrap();
        let unresolved = write_yaml_with(tmp.path(), "a.md", &yaml_one_comment("a.md", false));
        let unresolved_canon = canon(&unresolved);

        let report = delete_resolved_sidecars(tmp.path(), true, false).unwrap();

        assert_eq!(report.deleted.len(), 1);
        assert_eq!(report.deleted[0], unresolved_canon);
        assert!(report.skipped.is_empty());
        assert!(!unresolved.exists());
    }

    #[test]
    fn cleanup_empty_sidecar_always_skipped() {
        let tmp = TempDir::new().unwrap();
        let empty = write_yaml_with(tmp.path(), "a.md", &yaml_empty("a.md"));

        // Even with include_unresolved=true, empty sidecars are preserved.
        let report = delete_resolved_sidecars(tmp.path(), true, false).unwrap();

        assert!(report.deleted.is_empty());
        assert_eq!(report.skipped, vec![canon(&empty)]);
        assert!(empty.exists());
    }

    #[test]
    fn cleanup_dry_run_reports_without_mutation() {
        let tmp = TempDir::new().unwrap();
        let resolved = write_yaml_with(tmp.path(), "a.md", &yaml_one_comment("a.md", true));

        let report = delete_resolved_sidecars(tmp.path(), false, true).unwrap();

        assert_eq!(report.deleted, vec![canon(&resolved)]);
        assert!(resolved.exists(), "dry_run must not delete the file");
    }

    #[test]
    fn cleanup_walks_nested_directories() {
        let tmp = TempDir::new().unwrap();
        let sub = tmp.path().join("nested").join("deep");
        std::fs::create_dir_all(&sub).unwrap();
        let resolved = write_yaml_with(&sub, "a.md", &yaml_one_comment("a.md", true));
        let resolved_canon = canon(&resolved);

        let report = delete_resolved_sidecars(tmp.path(), false, false).unwrap();

        assert_eq!(report.deleted, vec![resolved_canon]);
        assert!(!resolved.exists());
    }

    #[test]
    fn cleanup_handles_mixed_yaml_and_json() {
        let tmp = TempDir::new().unwrap();
        let yaml_resolved =
            write_yaml_with(tmp.path(), "a.md", &yaml_one_comment("a.md", true));
        let json_resolved = write_json_with(
            tmp.path(),
            "b.md",
            r#"{"mrsf_version":"1.0","document":"b.md","comments":[{"id":"c1","author":"t","timestamp":"2025-01-01T00:00:00Z","text":"x","resolved":true}]}"#,
        );
        let json_unresolved = write_json_with(
            tmp.path(),
            "c.md",
            r#"{"mrsf_version":"1.0","document":"c.md","comments":[{"id":"c1","author":"t","timestamp":"2025-01-01T00:00:00Z","text":"x","resolved":false}]}"#,
        );
        let yaml_resolved_canon = canon(&yaml_resolved);
        let json_resolved_canon = canon(&json_resolved);
        let json_unresolved_canon = canon(&json_unresolved);

        let report = delete_resolved_sidecars(tmp.path(), false, false).unwrap();

        let mut deleted = report.deleted.clone();
        deleted.sort();
        let mut expected = vec![yaml_resolved_canon, json_resolved_canon];
        expected.sort();
        assert_eq!(deleted, expected);
        assert_eq!(report.skipped, vec![json_unresolved_canon]);
        assert!(!yaml_resolved.exists());
        assert!(!json_resolved.exists());
        assert!(json_unresolved.exists());
    }
}
