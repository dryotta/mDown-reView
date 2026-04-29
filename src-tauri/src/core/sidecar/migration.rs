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

/// Canonical default folder name used when no `sidecar_root` is configured
/// in `.mrsf.yaml`. This is the same name written by `set_sidecar_config`
/// when the dialog toggle is enabled, so users who flip the toggle off can
/// still see (and rescue) any files left behind in `<root>/.reviews/`.
pub const DEFAULT_SIDECAR_FOLDER: &str = ".reviews";

/// Resolve the effective sidecar-root folder for both counting and migration.
///
/// * If `configured` is `Some`, it is returned as-is.
/// * If `configured` is `None` and `<root>/.reviews/` exists as a directory,
///   `Some(".reviews")` is returned so stranded files can be detected and
///   migrated back to co-located positions even after the toggle has been
///   disabled (or when the user opens a workspace whose `.reviews/` folder
///   pre-dates `.mrsf.yaml`).
/// * If `configured` is `None` and `.reviews/` does not exist, returns
///   `None` — there is genuinely nothing to do.
pub fn effective_sidecar_root(root: &Path, configured: Option<&Path>) -> Option<PathBuf> {
    if let Some(sr) = configured {
        return Some(sr.to_path_buf());
    }
    let p = root.join(DEFAULT_SIDECAR_FOLDER);
    if p.is_dir() {
        Some(PathBuf::from(DEFAULT_SIDECAR_FOLDER))
    } else {
        None
    }
}

/// Create a walker for sidecar scanning. Respects `.gitignore` so heavy
/// directories (`node_modules/`, `target/`, etc.) are skipped — but uses
/// override whitelists so `.review.yaml` and `.review.json` files are
/// ALWAYS visible, even when gitignored. Sidecars are app-managed metadata,
/// not source code, and must not be hidden by project ignore rules.
pub fn sidecar_walker(root: &Path) -> impl Iterator<Item = ignore::DirEntry> {
    let mut ob = ignore::overrides::OverrideBuilder::new(root);
    ob.add("*.review.yaml").expect("static glob");
    ob.add("*.review.json").expect("static glob");
    let overrides = ob.build().expect("static glob");

    ignore::WalkBuilder::new(root)
        .max_depth(Some(50))
        .hidden(false) // don't skip dotdirs — .reviews/ is a dotdir
        .overrides(overrides)
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
/// *co-located*. When `None`, the function still falls back to
/// `<root>/.reviews/` (see [`effective_sidecar_root`]) so users can
/// detect — and subsequently rescue — files stranded in the default
/// folder after the toggle has been disabled.
pub fn count_sidecars(root: &Path, sidecar_root: Option<&Path>) -> SidecarCounts {
    let effective = effective_sidecar_root(root, sidecar_root);
    let folder_prefix: Option<PathBuf> = effective.as_ref().map(|sr| root.join(sr));
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
        if let Some(prefix) = folder_prefix.as_ref() {
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
#[derive(Debug, Clone, serde::Deserialize, specta::Type)]
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

    /// Regression: gitignored sidecar files must still be counted.
    /// Sidecars are app-managed metadata, not source code — `.gitignore`
    /// must not hide them from the counter, scanner, or migration. See
    /// commit history around the `ignore::OverrideBuilder` whitelist.
    #[test]
    fn count_finds_gitignored_sidecars() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();

        // Write a .gitignore that ignores all *.review.yaml files
        std::fs::write(root.join(".gitignore"), "*.review.yaml\n").unwrap();
        write_sidecar(&root.join("src/foo.md.review.yaml"));
        write_sidecar(&root.join("src/bar.md.review.json"));

        let counts = count_sidecars(root, None);
        assert_eq!(counts.count_colocated, 2, "gitignored sidecars must still be counted");
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

    // ── effective_sidecar_root ─────────────────────────────────────────

    #[test]
    fn effective_returns_configured_when_some() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        let custom = PathBuf::from("custom-folder");
        let r = effective_sidecar_root(root, Some(&custom));
        assert_eq!(r, Some(custom));
    }

    #[test]
    fn effective_falls_back_to_dot_reviews_when_dir_exists() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        std::fs::create_dir(root.join(".reviews")).unwrap();
        let r = effective_sidecar_root(root, None);
        assert_eq!(r, Some(PathBuf::from(".reviews")));
    }

    #[test]
    fn effective_returns_none_when_no_config_and_no_dot_reviews() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        let r = effective_sidecar_root(root, None);
        assert_eq!(r, None);
    }

    /// `.reviews` may exist as a regular file (unusual but legal). Treat it
    /// as "no folder" so the rescue path is a harmless no-op rather than an
    /// error chasing a non-directory target.
    #[test]
    fn effective_returns_none_when_dot_reviews_is_a_file() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        std::fs::write(root.join(".reviews"), b"not a dir").unwrap();
        let r = effective_sidecar_root(root, None);
        assert_eq!(r, None);
    }
}
