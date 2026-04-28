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
mod yaml_surgery;

use crate::core::mrsf_version::mrsf_version_for;
use crate::core::types::{CommentMutation, MrsfComment, MrsfSidecar};
// Re-export IO guards so sibling core modules (e.g. paths.rs) can reuse
// the same capped-read + anchor-rejection defenses for config files.
pub(crate) use io_guards::{read_capped, reject_yaml_anchors};
use std::collections::HashSet;
use std::fmt;
use std::path::Path;

#[derive(Debug)]
pub enum SidecarError {
    Io(std::io::Error),
    YamlParse(String),
    JsonParse(serde_json::Error),
    NotFound,
    CommentNotFound(String),
    UnsupportedVersion(String),
}

impl fmt::Display for SidecarError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            SidecarError::Io(e) => write!(f, "IO error: {}", e),
            SidecarError::YamlParse(msg) => write!(f, "YAML parse error: {}", msg),
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

/// Load a sidecar from explicit YAML/JSON paths.
/// Tries `yaml_path` first, then `json_path`. Returns `None` if neither exists.
pub fn load_sidecar_at(
    yaml_path: &str,
    json_path: &str,
) -> Result<Option<MrsfSidecar>, SidecarError> {
    match read_capped(yaml_path) {
        Ok(content) => {
            reject_yaml_anchors(&content)?;
            let sidecar: MrsfSidecar =
                serde_saphyr::from_str(&content).map_err(|e| SidecarError::YamlParse(e.to_string()))?;
            reject_unsupported_version(&sidecar)?;
            validate_sidecar_warnings(&sidecar);
            return Ok(Some(sidecar));
        }
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => {
            return Err(SidecarError::Io(e));
        }
        _ => {} // Not found, try JSON
    }

    match read_capped(json_path) {
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

/// Load a sidecar file. Tries .review.yaml first, then .review.json.
/// Returns None if no sidecar exists.
pub fn load_sidecar(file_path: &str) -> Result<Option<MrsfSidecar>, SidecarError> {
    let yaml_path = format!("{}.review.yaml", file_path);
    let json_path = format!("{}.review.json", file_path);
    load_sidecar_at(&yaml_path, &json_path)
}

/// Save a complete sidecar to an explicit path. Atomically writes via
/// temp+rename. Deletes the sidecar if comments is empty.
pub fn save_sidecar_at(
    sidecar_path: &Path,
    document: &str,
    comments: &[MrsfComment],
) -> Result<(), SidecarError> {
    if comments.is_empty() {
        if sidecar_path.exists() {
            std::fs::remove_file(sidecar_path)?;
        }
        return Ok(());
    }

    let payload = MrsfSidecar {
        mrsf_version: mrsf_version_for(comments).to_string(),
        document: document.to_string(),
        comments: comments.to_vec(),
    };
    let yaml = serde_saphyr::to_string(&payload).map_err(|e| SidecarError::YamlParse(e.to_string()))?;

    crate::core::atomic::write_atomic(sidecar_path, yaml.as_bytes())?;
    Ok(())
}

/// Save a complete sidecar. Atomically writes via temp+rename.
/// Deletes the sidecar if comments is empty.
pub fn save_sidecar(
    file_path: &str,
    document: &str,
    comments: &[MrsfComment],
) -> Result<(), SidecarError> {
    let sidecar_path = std::path::PathBuf::from(format!("{}.review.yaml", file_path));
    save_sidecar_at(&sidecar_path, document, comments)
}

/// Surgically modify a comment in a sidecar file at explicit paths.
///
/// Attempts format-preserving YAML surgery first (preserves comments,
/// key ordering, scalar styles). Falls back to the lossy
/// parse→mutate→serialize path if surgery cannot handle the input.
pub fn patch_comment_at(
    yaml_path: &str,
    json_path: &str,
    comment_id: &str,
    mutations: &[CommentMutation],
) -> Result<(), SidecarError> {
    // ── Fast path: format-preserving surgery on YAML ──────────────
    if let Ok(original) = read_capped(yaml_path) {
        if reject_yaml_anchors(&original).is_ok() {
            if let Some(patched) = yaml_surgery::try_patch(&original, comment_id, mutations) {
                // Validate: the result must still parse as valid YAML.
                let _: serde_json::Value = serde_saphyr::from_str(&patched)
                    .map_err(|e| SidecarError::YamlParse(e.to_string()))?;
                crate::core::atomic::write_atomic(Path::new(yaml_path), patched.as_bytes())?;
                return Ok(());
            }
        }
        // Surgery returned None — fall through to lossy path.
    }

    // ── Fallback: parse → mutate → serialize (lossy) ──────────────
    let content = match read_capped(yaml_path) {
        Ok(c) => {
            reject_yaml_anchors(&c)?;
            c
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            match read_capped(json_path) {
                Ok(c) => {
                    // Convert JSON to YAML Value
                    let json_val: serde_json::Value =
                        serde_json::from_str(&c).map_err(SidecarError::JsonParse)?;
                    serde_saphyr::to_string(&json_val).map_err(|e| SidecarError::YamlParse(e.to_string()))?
                }
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                    return Err(SidecarError::NotFound);
                }
                Err(e) => return Err(SidecarError::Io(e)),
            }
        }
        Err(e) => return Err(SidecarError::Io(e)),
    };

    let mut doc: serde_json::Value =
        serde_saphyr::from_str(&content).map_err(|e| SidecarError::YamlParse(e.to_string()))?;

    let comments = doc
        .get_mut("comments")
        .and_then(|v| v.as_array_mut())
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
                comment["resolved"] = serde_json::Value::Bool(*resolved);
            }
            CommentMutation::AddResponse {
                author,
                text,
                timestamp,
            } => {
                let responses = comment
                    .get_mut("responses")
                    .and_then(|v| v.as_array_mut());
                let new_response = serde_json::json!({
                    "author": author,
                    "text": text,
                    "timestamp": timestamp,
                });
                match responses {
                    Some(seq) => seq.push(new_response),
                    None => {
                        comment["responses"] = serde_json::Value::Array(vec![new_response]);
                    }
                }
            }
        }
    }

    let yaml_out = serde_saphyr::to_string(&doc).map_err(|e| SidecarError::YamlParse(e.to_string()))?;

    // Atomic write — always target the provided yaml_path.
    crate::core::atomic::write_atomic(Path::new(yaml_path), yaml_out.as_bytes())?;
    Ok(())
}

/// Surgically modify a comment in a co-located sidecar file.
/// Delegates to `patch_comment_at` with derived YAML/JSON paths.
pub fn patch_comment(
    file_path: &str,
    comment_id: &str,
    mutations: &[CommentMutation],
) -> Result<(), SidecarError> {
    let yaml_path = format!("{}.review.yaml", file_path);
    let json_path = format!("{}.review.json", file_path);
    patch_comment_at(&yaml_path, &json_path, comment_id, mutations)
}
#[cfg(test)]
#[path = "tests.rs"]
mod tests;
