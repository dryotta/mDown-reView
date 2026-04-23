use crate::core::types::MrsfSidecar;

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
}
