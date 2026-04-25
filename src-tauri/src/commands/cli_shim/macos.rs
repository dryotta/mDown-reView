//! macOS implementation: manage `/usr/local/bin/mdownreview` symlink into the
//! shipping `.app` bundle. All destructive ops refuse unless the symlink's
//! canonical target lies inside the canonical app-bundle root.

use super::{CliShimError, CliShimStatus};
use std::path::{Path, PathBuf};
use tauri::AppHandle;

const SHIM_PATH: &str = "/usr/local/bin/mdownreview";

fn io_err(e: std::io::Error) -> CliShimError {
    CliShimError::Io { message: e.to_string() }
}

fn app_bundle_root(_app: &AppHandle) -> Result<PathBuf, CliShimError> {
    // current_exe() points at .app/Contents/MacOS/mdownreview
    let exe = std::env::current_exe().map_err(io_err)?;
    let canonical = std::fs::canonicalize(&exe).map_err(io_err)?;
    canonical
        .ancestors()
        .nth(3) // .../X.app/Contents/MacOS/mdownreview -> .../X.app
        .map(|p| p.to_path_buf())
        .ok_or_else(|| CliShimError::Io {
            message: "could not resolve .app root".into(),
        })
}

pub fn status(app: &AppHandle) -> CliShimStatus {
    status_at(Path::new(SHIM_PATH), app_bundle_root(app).ok().as_deref())
}

pub fn install(app: &AppHandle) -> Result<(), CliShimError> {
    let root = app_bundle_root(app)?;
    let target = root.join("Contents/MacOS/mdownreview-cli");
    install_at(Path::new(SHIM_PATH), &target)
}

pub fn remove(app: &AppHandle) -> Result<(), CliShimError> {
    let root = app_bundle_root(app)?;
    remove_at(Path::new(SHIM_PATH), &root)
}

// --- Pure injectable functions (testable on any path) ---

pub fn status_at(shim: &Path, app_root: Option<&Path>) -> CliShimStatus {
    let meta = match std::fs::symlink_metadata(shim) {
        Ok(m) => m,
        Err(_) => return CliShimStatus::Missing,
    };
    if !meta.file_type().is_symlink() {
        return CliShimStatus::Broken;
    }
    let target = match std::fs::canonicalize(shim) {
        Ok(t) => t,
        Err(_) => return CliShimStatus::Broken, // dangling symlink
    };
    if let Some(root) = app_root {
        if let Ok(canonical_root) = std::fs::canonicalize(root) {
            if target.starts_with(&canonical_root) {
                return CliShimStatus::Done;
            }
        }
    }
    CliShimStatus::Broken
}

/// Map an `io::Error` to either `PermissionDenied { path, target }` (for EACCES /
/// EPERM) or a generic `Io` variant. `target` is the symlink target so the FE
/// can render a valid `sudo ln -sf <target> <path>` retry hint.
fn map_install_err(e: std::io::Error, shim: &Path, target: &Path) -> CliShimError {
    use std::io::ErrorKind;
    match e.kind() {
        ErrorKind::PermissionDenied => CliShimError::PermissionDenied {
            path: shim.display().to_string(),
            target: target.display().to_string(),
        },
        _ => CliShimError::Io { message: e.to_string() },
    }
}

pub fn install_at(shim: &Path, target: &Path) -> Result<(), CliShimError> {
    if shim.exists() {
        std::fs::remove_file(shim).map_err(|e| map_install_err(e, shim, target))?;
    }
    std::os::unix::fs::symlink(target, shim).map_err(|e| map_install_err(e, shim, target))
}

/// Refuses to remove anything that isn't a symlink whose canonicalized target
/// lives inside the canonicalized app-bundle root. SECURITY ORACLE: every
/// refusal path leaves both the shim and its target byte-identical.
pub fn remove_at(shim: &Path, app_root: &Path) -> Result<(), CliShimError> {
    let meta = std::fs::symlink_metadata(shim).map_err(io_err)?;
    if !meta.file_type().is_symlink() {
        return Err(CliShimError::Io {
            message: "refusing: not a symlink".into(),
        });
    }
    let target = std::fs::canonicalize(shim).map_err(|_| CliShimError::Io {
        message: "refusing: broken symlink".into(),
    })?;
    let canonical_root = std::fs::canonicalize(app_root).map_err(io_err)?;
    if !target.starts_with(&canonical_root) {
        return Err(CliShimError::Io {
            message: "refusing: target outside app bundle".into(),
        });
    }
    std::fs::remove_file(shim).map_err(|e| map_install_err(e, shim, &target))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::symlink;
    use tempfile::tempdir;

    #[test]
    fn refuse_when_not_a_symlink() {
        let dir = tempdir().unwrap();
        let shim = dir.path().join("shim");
        std::fs::write(&shim, b"not a symlink").unwrap();
        let fake_app = dir.path().join("Other.app");
        std::fs::create_dir_all(&fake_app).unwrap();
        let err = remove_at(&shim, &fake_app).unwrap_err().to_string();
        assert!(err.contains("not a symlink"), "got: {err}");
        assert!(shim.exists(), "shim must not be deleted on refusal");
        assert_eq!(std::fs::read(&shim).unwrap(), b"not a symlink");
    }

    #[test]
    fn refuse_when_target_outside_bundle() {
        let dir = tempdir().unwrap();
        let bystander = dir.path().join("important.txt");
        std::fs::write(&bystander, b"DO NOT DELETE").unwrap();
        let shim = dir.path().join("shim");
        symlink(&bystander, &shim).unwrap();
        let fake_app = dir.path().join("Other.app");
        std::fs::create_dir_all(&fake_app).unwrap();
        let err = remove_at(&shim, &fake_app).unwrap_err().to_string();
        assert!(err.contains("outside app bundle"), "got: {err}");
        assert!(bystander.exists(), "bystander must not be deleted");
        assert_eq!(std::fs::read(&bystander).unwrap(), b"DO NOT DELETE");
        assert!(shim.exists(), "shim must not be deleted on refusal");
    }

    #[test]
    fn ok_when_target_inside_bundle() {
        let dir = tempdir().unwrap();
        let app = dir.path().join("Mdownreview.app");
        let target_dir = app.join("Contents/MacOS");
        std::fs::create_dir_all(&target_dir).unwrap();
        let target = target_dir.join("mdownreview-cli");
        std::fs::write(&target, b"cli binary").unwrap();
        let shim = dir.path().join("shim");
        symlink(&target, &shim).unwrap();
        remove_at(&shim, &app).unwrap();
        assert!(!shim.exists(), "shim must be removed on success");
        assert!(target.exists(), "target must remain on success");
    }

    #[test]
    fn refuse_when_broken_symlink() {
        let dir = tempdir().unwrap();
        let nonexistent = dir.path().join("does-not-exist");
        let shim = dir.path().join("shim");
        symlink(&nonexistent, &shim).unwrap();
        let fake_app = dir.path().join("App");
        std::fs::create_dir_all(&fake_app).unwrap();
        let err = remove_at(&shim, &fake_app).unwrap_err().to_string();
        assert!(err.contains("broken symlink"), "got: {err}");
        // Use symlink_metadata so we check the symlink entry itself (Path::exists
        // follows the link and returns false for broken symlinks).
        assert!(
            std::fs::symlink_metadata(&shim).is_ok(),
            "shim must not be deleted on refusal",
        );
    }

    #[test]
    fn status_done_for_symlink_into_bundle() {
        let dir = tempdir().unwrap();
        let app = dir.path().join("App");
        let target = app.join("Contents/MacOS/mdownreview-cli");
        std::fs::create_dir_all(target.parent().unwrap()).unwrap();
        std::fs::write(&target, b"cli").unwrap();
        let shim = dir.path().join("shim");
        symlink(&target, &shim).unwrap();
        assert_eq!(status_at(&shim, Some(&app)), CliShimStatus::Done);
    }

    #[test]
    fn status_missing_when_no_file() {
        let dir = tempdir().unwrap();
        let shim = dir.path().join("shim");
        let app = dir.path().join("App");
        std::fs::create_dir_all(&app).unwrap();
        assert_eq!(status_at(&shim, Some(&app)), CliShimStatus::Missing);
    }
}
