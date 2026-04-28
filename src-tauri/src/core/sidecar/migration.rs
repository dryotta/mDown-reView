//! Sidecar migration — count and move `.review.yaml`/`.review.json` files
//! between co-located and folder-based layouts.
//!
//! Scanning caps: `max_depth(50)` (matches `find_review_files` in
//! `core/scanner.rs`) and 10 000 files visited (performance.md rule 1).

use crate::core::atomic::write_atomic;
use crate::core::sidecar::read_capped;
use std::path::{Path, PathBuf};

/// Hard ceiling on sidecar files matched during a walk (performance.md rule 1).
const MAX_FILES_SCANNED: usize = 10_000;

/// Create a gitignore-aware walker for sidecar scanning.
/// Respects `.gitignore` so `node_modules/`, `.git/`, `target/`, etc. are
/// skipped automatically without a hardcoded list.
fn sidecar_walker(root: &Path) -> impl Iterator<Item = ignore::DirEntry> {
    ignore::WalkBuilder::new(root)
        .max_depth(Some(50))
        .hidden(false) // don't skip dotfiles — .reviews/ is a dotdir
        .build()
        .filter_map(|e| e.ok())
}

// ── Counting ────────────────────────────────────────────────────────────

/// Tallies of sidecar files per layout.
#[derive(Debug, Clone, Default, serde::Serialize)]
pub struct SidecarCounts {
    /// Sidecars stored under the configured `sidecar_root` folder.
    pub count_in_folder: u32,
    /// Sidecars co-located next to their source file.
    pub count_colocated: u32,
}

/// Walk `root` and count `.review.yaml` / `.review.json` sidecars.
///
/// When `sidecar_root` is `Some`, sidecars whose path starts with
/// `root/sidecar_root` are counted as *in-folder*; all others are
/// *co-located*. When `None`, every sidecar is co-located.
pub fn count_sidecars(root: &Path, sidecar_root: Option<&Path>) -> SidecarCounts {
    let folder_prefix: Option<PathBuf> = sidecar_root.map(|sr| root.join(sr));
    // When disabled, still detect files in the default .reviews/ dir so users
    // can see stranded sidecars and re-enable to migrate them back.
    let fallback_prefix: Option<PathBuf> = if folder_prefix.is_none() {
        let p = root.join(".reviews");
        if p.is_dir() { Some(p) } else { None }
    } else {
        None
    };
    let effective_prefix = folder_prefix.as_ref().or(fallback_prefix.as_ref());
    let mut counts = SidecarCounts::default();
    let mut visited: usize = 0;

    for entry in sidecar_walker(root) {
        if !is_sidecar(entry.path()) {
            continue;
        }
        visited += 1;
        if visited > MAX_FILES_SCANNED {
            break;
        }
        if let Some(prefix) = effective_prefix {
            if entry.path().starts_with(prefix) {
                counts.count_in_folder += 1;
            } else {
                counts.count_colocated += 1;
            }
        } else {
            counts.count_colocated += 1;
        }
    }
    counts
}

// ── Migration ───────────────────────────────────────────────────────────

/// Direction to migrate sidecars.
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MigrateDirection {
    /// Move co-located sidecars into the `sidecar_root` folder.
    ToFolder,
    /// Move folder sidecars back to co-located positions.
    ToColocated,
}

/// Outcome of a migration run.
#[derive(Debug, Clone, Default, serde::Serialize)]
pub struct MigrationResult {
    /// Number of files successfully moved.
    pub moved: u32,
    /// Human-readable descriptions of files that could not be moved.
    pub failed: Vec<String>,
}

/// Move sidecars between co-located and folder layouts.
///
/// * `root` — canonical workspace root.
/// * `sidecar_root` — relative path of the folder layout root (e.g.
///   `.reviews`).  Joined onto `root` internally.
/// * `direction` — which way to migrate.
///
/// Files are moved via read → atomic-write → delete-source. A target
/// that already exists is skipped (added to `failed`). Errors are
/// non-fatal: each file is attempted independently.
pub fn migrate_sidecars(
    root: &Path,
    sidecar_root: &Path,
    direction: MigrateDirection,
) -> MigrationResult {
    let folder_abs = root.join(sidecar_root);
    let mut result = MigrationResult::default();
    let mut visited: usize = 0;

    for entry in sidecar_walker(root) {
        let src = entry.path();
        if !is_sidecar(src) {
            continue;
        }
        visited += 1;
        if visited > MAX_FILES_SCANNED {
            break;
        }

        let is_in_folder = src.starts_with(&folder_abs);

        // Only migrate files going the requested direction.
        let target = match direction {
            MigrateDirection::ToFolder => {
                if is_in_folder {
                    continue; // already in folder
                }
                // co-located → folder: root-relative path → sidecar_root/<rel>
                let rel = match src.strip_prefix(root) {
                    Ok(r) => r,
                    Err(_) => continue,
                };
                root.join(sidecar_root).join(rel)
            }
            MigrateDirection::ToColocated => {
                if !is_in_folder {
                    continue; // not in folder
                }
                // folder → co-located: strip folder prefix, re-root
                let rel = match src.strip_prefix(&folder_abs) {
                    Ok(r) => r,
                    Err(_) => continue,
                };
                root.join(rel)
            }
        };

        if target.exists() {
            result.failed.push(format!(
                "target already exists: {}",
                target.display()
            ));
            continue;
        }

        // Read via the IO-guard chokepoint (10 MB cap).
        let src_str = src.to_string_lossy();
        let content = match read_capped(&src_str) {
            Ok(c) => c,
            Err(e) => {
                log::warn!("migration: failed to read {}: {e}", src.display());
                result
                    .failed
                    .push(format!("read failed: {}: {e}", src.display()));
                continue;
            }
        };

        // Atomic write to target (creates parent dirs).
        if let Err(e) = write_atomic(&target, content.as_bytes()) {
            log::warn!("migration: failed to write {}: {e}", target.display());
            result
                .failed
                .push(format!("write failed: {}: {e}", target.display()));
            continue;
        }

        // Delete source only after successful write.
        if let Err(e) = std::fs::remove_file(src) {
            log::warn!("migration: failed to remove source {}: {e}", src.display());
            result.failed.push(format!(
                "source removal failed: {}: {e}",
                src.display()
            ));
            continue;
        }

        result.moved += 1;
    }
    result
}

// ── Helpers ─────────────────────────────────────────────────────────────

/// True when the file name ends with `.review.yaml` or `.review.json`.
fn is_sidecar(path: &Path) -> bool {
    path.file_name()
        .and_then(|n| n.to_str())
        .map_or(false, |n| {
            n.ends_with(".review.yaml") || n.ends_with(".review.json")
        })
}

// ── Tests ───────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    /// Helper: write a minimal sidecar to `path`, creating parents.
    fn write_sidecar(path: &Path) {
        if let Some(p) = path.parent() {
            std::fs::create_dir_all(p).unwrap();
        }
        std::fs::write(path, "comments: []\n").unwrap();
    }

    #[test]
    fn count_mixed_colocated_and_folder() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();

        // Two co-located sidecars
        write_sidecar(&root.join("src/main.rs.review.yaml"));
        write_sidecar(&root.join("src/lib.rs.review.json"));

        // One folder sidecar
        write_sidecar(&root.join(".reviews/src/main.rs.review.yaml"));

        let counts = count_sidecars(root, Some(Path::new(".reviews")));
        assert_eq!(counts.count_colocated, 2);
        assert_eq!(counts.count_in_folder, 1);
    }

    #[test]
    fn count_no_sidecar_root_all_colocated() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();

        write_sidecar(&root.join(".reviews/a.rs.review.yaml"));
        write_sidecar(&root.join("b.rs.review.yaml"));

        // Without a sidecar_root, files in .reviews/ are still detected as
        // in-folder so users can see stranded sidecars and migrate them back.
        let counts = count_sidecars(root, None);
        assert_eq!(counts.count_colocated, 1);
        assert_eq!(counts.count_in_folder, 1);
    }

    #[test]
    fn migrate_to_folder() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();

        write_sidecar(&root.join("src/main.rs.review.yaml"));
        write_sidecar(&root.join("docs/readme.md.review.json"));

        let result =
            migrate_sidecars(root, Path::new(".reviews"), MigrateDirection::ToFolder);

        assert_eq!(result.moved, 2);
        assert!(result.failed.is_empty());

        // Targets exist
        assert!(root.join(".reviews/src/main.rs.review.yaml").exists());
        assert!(root.join(".reviews/docs/readme.md.review.json").exists());

        // Sources removed
        assert!(!root.join("src/main.rs.review.yaml").exists());
        assert!(!root.join("docs/readme.md.review.json").exists());
    }

    #[test]
    fn migrate_to_colocated() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();

        write_sidecar(&root.join(".reviews/src/main.rs.review.yaml"));

        let result =
            migrate_sidecars(root, Path::new(".reviews"), MigrateDirection::ToColocated);

        assert_eq!(result.moved, 1);
        assert!(result.failed.is_empty());
        assert!(root.join("src/main.rs.review.yaml").exists());
        assert!(!root.join(".reviews/src/main.rs.review.yaml").exists());
    }

    #[test]
    fn migrate_skips_existing_target() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();

        // Source (co-located)
        write_sidecar(&root.join("a.rs.review.yaml"));
        // Target already exists
        write_sidecar(&root.join(".reviews/a.rs.review.yaml"));

        let result =
            migrate_sidecars(root, Path::new(".reviews"), MigrateDirection::ToFolder);

        assert_eq!(result.moved, 0);
        assert_eq!(result.failed.len(), 1);
        assert!(result.failed[0].contains("target already exists"));
    }

    #[test]
    fn migrate_nested_preserves_paths() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();

        write_sidecar(&root.join("a/b/c/deep.rs.review.yaml"));

        let result =
            migrate_sidecars(root, Path::new(".reviews"), MigrateDirection::ToFolder);

        assert_eq!(result.moved, 1);
        assert!(root.join(".reviews/a/b/c/deep.rs.review.yaml").exists());
    }
}
