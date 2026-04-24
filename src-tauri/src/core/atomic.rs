//! Atomic file-write helper.
//!
//! Writes bytes to a sibling temp file then renames over the target so a
//! crash mid-write can never leave a half-written destination behind. Used
//! by sidecar persistence and any future code that needs durable writes.

use std::path::Path;

/// Write `bytes` to `target` atomically (temp + rename).
///
/// Creates `target`'s parent directory if it does not yet exist. On rename
/// failure the temp file is removed best-effort so we don't leak `.tmp`
/// debris into the user's directory.
pub fn write_atomic(target: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let dir = target.parent().unwrap_or(Path::new("."));
    std::fs::create_dir_all(dir)?;
    let tmp = dir.join(format!(
        ".{}.{}.tmp",
        target
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("write"),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    ));
    std::fs::write(&tmp, bytes)?;
    if let Err(e) = std::fs::rename(&tmp, target) {
        let _ = std::fs::remove_file(&tmp);
        return Err(e);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn roundtrip_writes_bytes() {
        let tmp = TempDir::new().unwrap();
        let target = tmp.path().join("out.bin");
        write_atomic(&target, b"hello world").unwrap();
        let read = std::fs::read(&target).unwrap();
        assert_eq!(read, b"hello world");
    }

    #[test]
    fn overwrites_existing_file() {
        let tmp = TempDir::new().unwrap();
        let target = tmp.path().join("out.txt");
        std::fs::write(&target, b"old").unwrap();
        write_atomic(&target, b"new").unwrap();
        assert_eq!(std::fs::read(&target).unwrap(), b"new");
    }

    #[test]
    fn creates_missing_parent_dir() {
        let tmp = TempDir::new().unwrap();
        let target = tmp.path().join("nested/deeper/out.txt");
        write_atomic(&target, b"x").unwrap();
        assert_eq!(std::fs::read(&target).unwrap(), b"x");
    }

    #[test]
    fn no_tmp_files_left_after_success() {
        let tmp = TempDir::new().unwrap();
        let target = tmp.path().join("out.txt");
        write_atomic(&target, b"data").unwrap();
        let leftover: Vec<_> = std::fs::read_dir(tmp.path())
            .unwrap()
            .flatten()
            .filter(|e| {
                e.file_name()
                    .to_str()
                    .map(|s| s.ends_with(".tmp"))
                    .unwrap_or(false)
            })
            .collect();
        assert!(leftover.is_empty(), "temp file leaked: {:?}", leftover);
    }
}
