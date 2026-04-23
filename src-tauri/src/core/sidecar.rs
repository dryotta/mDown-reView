use crate::core::types::{CommentMutation, MrsfComment, MrsfSidecar};
use std::fmt;
use std::path::Path;

#[derive(Debug)]
pub enum SidecarError {
    Io(std::io::Error),
    YamlParse(serde_yaml_ng::Error),
    JsonParse(serde_json::Error),
    NotFound,
    CommentNotFound(String),
}

impl fmt::Display for SidecarError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            SidecarError::Io(e) => write!(f, "IO error: {}", e),
            SidecarError::YamlParse(e) => write!(f, "YAML parse error: {}", e),
            SidecarError::JsonParse(e) => write!(f, "JSON parse error: {}", e),
            SidecarError::NotFound => write!(f, "sidecar not found"),
            SidecarError::CommentNotFound(id) => write!(f, "comment not found: {}", id),
        }
    }
}

impl From<std::io::Error> for SidecarError {
    fn from(e: std::io::Error) -> Self {
        if e.kind() == std::io::ErrorKind::NotFound {
            SidecarError::NotFound
        } else {
            SidecarError::Io(e)
        }
    }
}

/// Load a sidecar file. Tries .review.yaml first, then .review.json.
/// Returns None if no sidecar exists.
pub fn load_sidecar(file_path: &str) -> Result<Option<MrsfSidecar>, SidecarError> {
    let yaml_path = format!("{}.review.yaml", file_path);
    let json_path = format!("{}.review.json", file_path);

    match std::fs::read_to_string(&yaml_path) {
        Ok(content) => {
            let sidecar: MrsfSidecar =
                serde_yaml_ng::from_str(&content).map_err(SidecarError::YamlParse)?;
            return Ok(Some(sidecar));
        }
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => {
            return Err(SidecarError::Io(e));
        }
        _ => {} // Not found, try JSON
    }

    match std::fs::read_to_string(&json_path) {
        Ok(content) => {
            let sidecar: MrsfSidecar =
                serde_json::from_str(&content).map_err(SidecarError::JsonParse)?;
            Ok(Some(sidecar))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(SidecarError::Io(e)),
    }
}

/// Save a complete sidecar. Atomically writes via temp+rename.
/// Deletes the sidecar if comments is empty.
pub fn save_sidecar(
    file_path: &str,
    document: &str,
    comments: &[MrsfComment],
) -> Result<(), SidecarError> {
    let sidecar_path = std::path::PathBuf::from(format!("{}.review.yaml", file_path));

    if comments.is_empty() {
        if sidecar_path.exists() {
            std::fs::remove_file(&sidecar_path)?;
        }
        return Ok(());
    }

    let payload = MrsfSidecar {
        mrsf_version: "1.0".to_string(),
        document: document.to_string(),
        comments: comments.to_vec(),
    };
    let yaml = serde_yaml_ng::to_string(&payload).map_err(SidecarError::YamlParse)?;

    let dir = sidecar_path
        .parent()
        .unwrap_or(Path::new("."));
    let tmp_path = dir.join(format!(
        ".review-{}.tmp",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    ));
    std::fs::write(&tmp_path, &yaml)?;
    if let Err(e) = std::fs::rename(&tmp_path, &sidecar_path) {
        let _ = std::fs::remove_file(&tmp_path);
        return Err(SidecarError::Io(e));
    }
    Ok(())
}

/// Surgically modify a comment in a sidecar file.
/// Loads as serde_yaml_ng::Value, finds comment by ID, applies mutations,
/// writes back preserving all unknown fields and structure.
pub fn patch_comment(
    file_path: &str,
    comment_id: &str,
    mutations: &[CommentMutation],
) -> Result<(), SidecarError> {
    let yaml_path = format!("{}.review.yaml", file_path);
    let json_path = format!("{}.review.json", file_path);

    // Determine which file exists and load as Value
    let (content, source_path) = match std::fs::read_to_string(&yaml_path) {
        Ok(c) => (c, yaml_path.clone()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            match std::fs::read_to_string(&json_path) {
                Ok(c) => {
                    // Convert JSON to YAML Value
                    let json_val: serde_json::Value =
                        serde_json::from_str(&c).map_err(SidecarError::JsonParse)?;
                    let yaml_str =
                        serde_yaml_ng::to_string(&json_val).map_err(SidecarError::YamlParse)?;
                    (yaml_str, yaml_path.clone()) // Write as YAML
                }
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                    return Err(SidecarError::NotFound);
                }
                Err(e) => return Err(SidecarError::Io(e)),
            }
        }
        Err(e) => return Err(SidecarError::Io(e)),
    };

    let mut doc: serde_yaml_ng::Value =
        serde_yaml_ng::from_str(&content).map_err(SidecarError::YamlParse)?;

    let comments = doc
        .get_mut("comments")
        .and_then(|v| v.as_sequence_mut())
        .ok_or_else(|| SidecarError::CommentNotFound(comment_id.to_string()))?;

    let comment = comments
        .iter_mut()
        .find(|c| {
            c.get("id")
                .and_then(|v| v.as_str())
                .map(|s| s == comment_id)
                .unwrap_or(false)
        })
        .ok_or_else(|| SidecarError::CommentNotFound(comment_id.to_string()))?;

    for mutation in mutations {
        match mutation {
            CommentMutation::SetResolved(resolved) => {
                comment["resolved"] = serde_yaml_ng::Value::Bool(*resolved);
            }
            CommentMutation::AddResponse {
                author,
                text,
                timestamp,
            } => {
                let responses = comment
                    .get_mut("responses")
                    .and_then(|v| v.as_sequence_mut());
                let new_response = serde_yaml_ng::Value::Mapping({
                    let mut m = serde_yaml_ng::Mapping::new();
                    m.insert(
                        serde_yaml_ng::Value::String("author".to_string()),
                        serde_yaml_ng::Value::String(author.clone()),
                    );
                    m.insert(
                        serde_yaml_ng::Value::String("text".to_string()),
                        serde_yaml_ng::Value::String(text.clone()),
                    );
                    m.insert(
                        serde_yaml_ng::Value::String("timestamp".to_string()),
                        serde_yaml_ng::Value::String(timestamp.clone()),
                    );
                    m
                });
                match responses {
                    Some(seq) => seq.push(new_response),
                    None => {
                        comment["responses"] =
                            serde_yaml_ng::Value::Sequence(vec![new_response]);
                    }
                }
            }
        }
    }

    let yaml_out = serde_yaml_ng::to_string(&doc).map_err(SidecarError::YamlParse)?;

    // Atomic write
    let dest = Path::new(&source_path);
    let dir = dest.parent().unwrap_or(Path::new("."));
    let tmp_path = dir.join(format!(
        ".review-{}.tmp",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    ));
    std::fs::write(&tmp_path, &yaml_out)?;
    // Always write as YAML
    let yaml_dest = Path::new(&yaml_path);
    if let Err(e) = std::fs::rename(&tmp_path, yaml_dest) {
        let _ = std::fs::remove_file(&tmp_path);
        return Err(SidecarError::Io(e));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::types::MrsfComment;
    use tempfile::TempDir;

    fn sample_comment(id: &str) -> MrsfComment {
        MrsfComment {
            id: id.to_string(),
            author: "test".to_string(),
            timestamp: "2025-01-01T00:00:00Z".to_string(),
            text: "test comment".to_string(),
            resolved: false,
            line: Some(1),
            end_line: None,
            start_column: None,
            end_column: None,
            selected_text: None,
            anchored_text: None,
            selected_text_hash: None,
            commit: None,
            comment_type: None,
            severity: None,
            reply_to: None,
        }
    }

    #[test]
    fn load_sidecar_yaml() {
        let tmp = TempDir::new().unwrap();
        let file_path = tmp.path().join("test.md");
        let sidecar_path = tmp.path().join("test.md.review.yaml");
        std::fs::write(&file_path, "# Test").unwrap();
        std::fs::write(
            &sidecar_path,
            r#"mrsf_version: "1.0"
document: test.md
comments:
  - id: "c1"
    author: "test"
    timestamp: "2025-01-01T00:00:00Z"
    text: "hello"
    resolved: false
"#,
        )
        .unwrap();

        let result = load_sidecar(file_path.to_str().unwrap()).unwrap();
        assert!(result.is_some());
        let sidecar = result.unwrap();
        assert_eq!(sidecar.comments.len(), 1);
        assert_eq!(sidecar.comments[0].id, "c1");
    }

    #[test]
    fn load_sidecar_json_fallback() {
        let tmp = TempDir::new().unwrap();
        let file_path = tmp.path().join("test.md");
        let json_path = tmp.path().join("test.md.review.json");
        std::fs::write(&file_path, "# Test").unwrap();
        std::fs::write(
            &json_path,
            r#"{"mrsf_version":"1.0","document":"test.md","comments":[{"id":"c1","author":"test","timestamp":"2025-01-01T00:00:00Z","text":"hello","resolved":false}]}"#,
        )
        .unwrap();

        let result = load_sidecar(file_path.to_str().unwrap()).unwrap();
        assert!(result.is_some());
        assert_eq!(result.unwrap().comments[0].id, "c1");
    }

    #[test]
    fn load_sidecar_missing_returns_none() {
        let tmp = TempDir::new().unwrap();
        let file_path = tmp.path().join("nonexistent.md");
        let result = load_sidecar(file_path.to_str().unwrap()).unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn save_sidecar_writes_yaml() {
        let tmp = TempDir::new().unwrap();
        let file_path = tmp.path().join("test.md");
        std::fs::write(&file_path, "# Test").unwrap();

        let comments = vec![sample_comment("c1")];
        save_sidecar(file_path.to_str().unwrap(), "test.md", &comments).unwrap();

        let sidecar_path = tmp.path().join("test.md.review.yaml");
        assert!(sidecar_path.exists());
        let content = std::fs::read_to_string(&sidecar_path).unwrap();
        assert!(content.contains("mrsf_version"));
        assert!(content.contains("c1"));
    }

    #[test]
    fn save_sidecar_empty_deletes() {
        let tmp = TempDir::new().unwrap();
        let file_path = tmp.path().join("test.md");
        let sidecar_path = tmp.path().join("test.md.review.yaml");
        std::fs::write(&file_path, "# Test").unwrap();
        std::fs::write(&sidecar_path, "dummy").unwrap();

        save_sidecar(file_path.to_str().unwrap(), "test.md", &[]).unwrap();
        assert!(!sidecar_path.exists());
    }

    #[test]
    fn patch_comment_resolve() {
        let tmp = TempDir::new().unwrap();
        let file_path = tmp.path().join("test.md");
        std::fs::write(&file_path, "# Test").unwrap();

        let comments = vec![sample_comment("c1"), sample_comment("c2")];
        save_sidecar(file_path.to_str().unwrap(), "test.md", &comments).unwrap();

        patch_comment(
            file_path.to_str().unwrap(),
            "c1",
            &[CommentMutation::SetResolved(true)],
        )
        .unwrap();

        let loaded = load_sidecar(file_path.to_str().unwrap())
            .unwrap()
            .unwrap();
        assert!(loaded.comments.iter().find(|c| c.id == "c1").unwrap().resolved);
        assert!(!loaded.comments.iter().find(|c| c.id == "c2").unwrap().resolved);
    }

    #[test]
    fn patch_comment_add_response() {
        let tmp = TempDir::new().unwrap();
        let file_path = tmp.path().join("test.md");
        std::fs::write(&file_path, "# Test").unwrap();

        let comments = vec![sample_comment("c1")];
        save_sidecar(file_path.to_str().unwrap(), "test.md", &comments).unwrap();

        patch_comment(
            file_path.to_str().unwrap(),
            "c1",
            &[CommentMutation::AddResponse {
                author: "agent".to_string(),
                text: "fixed it".to_string(),
                timestamp: "2025-01-02T00:00:00Z".to_string(),
            }],
        )
        .unwrap();

        let content =
            std::fs::read_to_string(tmp.path().join("test.md.review.yaml")).unwrap();
        assert!(content.contains("fixed it"));
        assert!(content.contains("responses"));
    }

    #[test]
    fn patch_comment_not_found() {
        let tmp = TempDir::new().unwrap();
        let file_path = tmp.path().join("test.md");
        std::fs::write(&file_path, "# Test").unwrap();

        let comments = vec![sample_comment("c1")];
        save_sidecar(file_path.to_str().unwrap(), "test.md", &comments).unwrap();

        let result = patch_comment(
            file_path.to_str().unwrap(),
            "nonexistent",
            &[CommentMutation::SetResolved(true)],
        );
        assert!(matches!(result, Err(SidecarError::CommentNotFound(_))));
    }
}
