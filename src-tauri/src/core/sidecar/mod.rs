//! Sidecar load / save / patch.
//!
//! Read-side I/O guards (size cap + YAML anchor rejection) live in
//! [`io_guards`] — see that module's doc-comment for the threat model.
//! All sidecar reads in this module MUST funnel through `read_capped`,
//! and YAML reads MUST additionally pass `reject_yaml_anchors` BEFORE
//! handing bytes to a parser. Order: `read_capped` → `reject_yaml_anchors`
//! → parse. JSON reads intentionally skip the YAML anchor check (anchors
//! are a YAML-only construct).

mod io_guards;

use crate::core::mrsf_version::mrsf_version_for;
use crate::core::types::{CommentMutation, MrsfComment, MrsfSidecar};
use io_guards::{read_capped, reject_yaml_anchors};
use std::collections::HashSet;
use std::fmt;
use std::path::Path;

#[derive(Debug)]
pub enum SidecarError {
    Io(std::io::Error),
    YamlParse(serde_yaml_ng::Error),
    JsonParse(serde_json::Error),
    NotFound,
    CommentNotFound(String),
    UnsupportedVersion(String),
}

impl fmt::Display for SidecarError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            SidecarError::Io(e) => write!(f, "IO error: {}", e),
            SidecarError::YamlParse(e) => write!(f, "YAML parse error: {}", e),
            SidecarError::JsonParse(e) => write!(f, "JSON parse error: {}", e),
            SidecarError::NotFound => write!(f, "sidecar not found"),
            SidecarError::CommentNotFound(id) => write!(f, "comment not found: {}", id),
            SidecarError::UnsupportedVersion(v) => {
                write!(f, "unsupported MRSF version: {}", v)
            }
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

/// Reject sidecars whose major version is unsupported (MRSF §5 MUST).
/// Accepts major version 1 (any minor); rejects anything else.
fn reject_unsupported_version(sidecar: &MrsfSidecar) -> Result<(), SidecarError> {
    let ver = &sidecar.mrsf_version;
    match ver.split('.').next().and_then(|m| m.parse::<u32>().ok()) {
        Some(1) => Ok(()),
        Some(_) | None => Err(SidecarError::UnsupportedVersion(ver.clone())),
    }
}

/// Post-load advisory validation (MRSF §6.2, §7.1, §10).
/// Logs warnings for data-quality issues; never rejects.
fn validate_sidecar_warnings(sidecar: &MrsfSidecar) {
    let ids: HashSet<&str> = sidecar.comments.iter().map(|c| c.id.as_str()).collect();

    for c in &sidecar.comments {
        // §6.2 — selected_text_hash integrity
        if let (Some(text), Some(hash)) = (&c.selected_text, &c.selected_text_hash) {
            let expected = crate::core::anchors::compute_selected_text_hash(text);
            if *hash != expected {
                tracing::warn!(
                    "[sidecar] comment {} has selected_text_hash mismatch (expected {}, got {})",
                    c.id,
                    expected,
                    hash
                );
            }
        }

        // §7.1 / §10 — cross-field constraints
        if let (Some(line), Some(end_line)) = (c.line, c.end_line) {
            if end_line < line {
                tracing::warn!(
                    "[sidecar] comment {} has end_line ({}) < line ({})",
                    c.id,
                    end_line,
                    line
                );
            }
            if line == end_line {
                if let (Some(sc), Some(ec)) = (c.start_column, c.end_column) {
                    if ec < sc {
                        tracing::warn!(
                            "[sidecar] comment {} has end_column ({}) < start_column ({})",
                            c.id,
                            ec,
                            sc
                        );
                    }
                }
            }
        }

        // §10 — dangling reply_to
        if let Some(ref reply_to) = c.reply_to {
            if !ids.contains(reply_to.as_str()) {
                tracing::warn!(
                    "[sidecar] comment {} has reply_to \"{}\" which does not resolve to any id",
                    c.id,
                    reply_to
                );
            }
        }
    }
}

/// Load a sidecar file. Tries .review.yaml first, then .review.json.
/// Returns None if no sidecar exists.
pub fn load_sidecar(file_path: &str) -> Result<Option<MrsfSidecar>, SidecarError> {
    let yaml_path = format!("{}.review.yaml", file_path);
    let json_path = format!("{}.review.json", file_path);

    match read_capped(&yaml_path) {
        Ok(content) => {
            reject_yaml_anchors(&content)?;
            let sidecar: MrsfSidecar =
                serde_yaml_ng::from_str(&content).map_err(SidecarError::YamlParse)?;
            reject_unsupported_version(&sidecar)?;
            validate_sidecar_warnings(&sidecar);
            return Ok(Some(sidecar));
        }
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => {
            return Err(SidecarError::Io(e));
        }
        _ => {} // Not found, try JSON
    }

    match read_capped(&json_path) {
        Ok(content) => {
            let sidecar: MrsfSidecar =
                serde_json::from_str(&content).map_err(SidecarError::JsonParse)?;
            reject_unsupported_version(&sidecar)?;
            validate_sidecar_warnings(&sidecar);
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
        mrsf_version: mrsf_version_for(comments).to_string(),
        document: document.to_string(),
        comments: comments.to_vec(),
    };
    let yaml = serde_yaml_ng::to_string(&payload).map_err(SidecarError::YamlParse)?;

    crate::core::atomic::write_atomic(&sidecar_path, yaml.as_bytes())?;
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
    let (content, _source_path) = match read_capped(&yaml_path) {
        Ok(c) => {
            reject_yaml_anchors(&c)?;
            (c, yaml_path.clone())
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            match read_capped(&json_path) {
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
                        comment["responses"] = serde_yaml_ng::Value::Sequence(vec![new_response]);
                    }
                }
            }
        }
    }

    let yaml_out = serde_yaml_ng::to_string(&doc).map_err(SidecarError::YamlParse)?;

    // Atomic write — always re-target YAML regardless of the original format.
    crate::core::atomic::write_atomic(Path::new(&yaml_path), yaml_out.as_bytes())?;
    Ok(())
}
#[cfg(test)]
#[path = "tests.rs"]
mod tests;
