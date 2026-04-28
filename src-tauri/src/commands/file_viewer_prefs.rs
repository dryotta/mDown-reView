//! Per-file viewer preferences — persisted across app restarts.
//!
//! Stores an `allow_images` flag per file (keyed by a hash of the
//! canonicalized path). Prefs are capped at `MAX_ENTRIES` with LRU eviction
//! on write so the config file stays bounded.
//!
//! File format: a flat JSON object mapping hash-keys to `{ allow_images, last_accessed }`.
//! Lives alongside `onboarding.json` in the app config dir.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::hash::{DefaultHasher, Hash, Hasher};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

const MAX_ENTRIES: usize = 500;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct FileViewerPrefs {
    entries: HashMap<String, FileViewerPrefEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileViewerPrefEntry {
    pub allow_images: bool,
    /// Epoch millis of last access — used for LRU eviction.
    pub last_accessed: u64,
}

/// The public-facing pref returned over IPC (no internal bookkeeping fields).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileViewerPref {
    pub allow_images: bool,
}

/// Hash a canonical path to a stable hex key using `DefaultHasher`.
/// NOT cryptographic — collision-resistance is sufficient for path keys at ≤500 entries.
pub fn hash_path(canonical: &Path) -> String {
    let mut hasher = DefaultHasher::new();
    canonical.to_string_lossy().hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

fn prefs_path(app: &AppHandle) -> PathBuf {
    let config_dir = app
        .path()
        .app_config_dir()
        .expect("app_config_dir must be available");
    config_dir.join("file_viewer_prefs.json")
}

/// Load prefs from disk. Returns `Default` on any failure (missing file,
/// corrupt JSON) — safe by default per `docs/security.md` rule 5.
pub fn load_prefs_at(path: &Path) -> FileViewerPrefs {
    match std::fs::read_to_string(path) {
        Ok(contents) => serde_json::from_str(&contents).unwrap_or_default(),
        Err(_) => FileViewerPrefs::default(),
    }
}

fn load_prefs(app: &AppHandle) -> FileViewerPrefs {
    load_prefs_at(&prefs_path(app))
}

fn save_prefs_at(path: &Path, prefs: &FileViewerPrefs) -> Result<(), String> {
    let json = serde_json::to_string_pretty(prefs).map_err(|e| e.to_string())?;
    crate::core::atomic::write_atomic(path, json.as_bytes()).map_err(|e| e.to_string())
}

fn save_prefs(app: &AppHandle, prefs: &FileViewerPrefs) -> Result<(), String> {
    save_prefs_at(&prefs_path(app), prefs)
}

fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

/// Evict oldest entries until len ≤ MAX_ENTRIES.
fn evict_lru(prefs: &mut FileViewerPrefs) {
    while prefs.entries.len() > MAX_ENTRIES {
        if let Some(oldest_key) = prefs
            .entries
            .iter()
            .min_by_key(|(_, v)| v.last_accessed)
            .map(|(k, _)| k.clone())
        {
            prefs.entries.remove(&oldest_key);
        }
    }
}

// ── Pure helpers (injectable path, no AppHandle) for tests ─────────────

pub fn get_pref_at(prefs_path: &Path, file_path: &Path) -> Option<FileViewerPref> {
    let canonical = std::fs::canonicalize(file_path).ok()?;
    let key = hash_path(&canonical);
    let prefs = load_prefs_at(prefs_path);
    prefs
        .entries
        .get(&key)
        .map(|e| FileViewerPref { allow_images: e.allow_images })
}

pub fn set_pref_at(
    prefs_path: &Path,
    file_path: &Path,
    allow_images: bool,
) -> Result<(), String> {
    let canonical = std::fs::canonicalize(file_path).map_err(|e| e.to_string())?;
    let key = hash_path(&canonical);
    let mut prefs = load_prefs_at(prefs_path);
    prefs.entries.insert(
        key,
        FileViewerPrefEntry {
            allow_images,
            last_accessed: now_millis(),
        },
    );
    evict_lru(&mut prefs);
    save_prefs_at(prefs_path, &prefs)
}

// ── IPC commands ──────────────────────────────────────────────────────

#[tauri::command]
pub fn get_file_viewer_pref(app: AppHandle, path: String) -> Option<FileViewerPref> {
    let canonical = match crate::core::paths::canonicalize_no_verbatim(std::path::Path::new(&path)) {
        Ok(c) => c,
        Err(_) => return None,
    };
    let key = hash_path(&canonical);
    let prefs = load_prefs(&app);
    prefs
        .entries
        .get(&key)
        .map(|e| FileViewerPref { allow_images: e.allow_images })
}

#[tauri::command]
pub fn set_file_viewer_pref(
    app: AppHandle,
    path: String,
    allow_images: bool,
) -> Result<(), String> {
    let canonical = crate::core::paths::canonicalize_no_verbatim(std::path::Path::new(&path))
        .map_err(|e| e.to_string())?;
    let key = hash_path(&canonical);
    let mut prefs = load_prefs(&app);
    prefs.entries.insert(
        key,
        FileViewerPrefEntry {
            allow_images,
            last_accessed: now_millis(),
        },
    );
    evict_lru(&mut prefs);
    save_prefs(&app, &prefs)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn hash_path_produces_different_hashes_for_different_paths() {
        let h1 = hash_path(Path::new("/a/b/c.html"));
        let h2 = hash_path(Path::new("/a/b/d.html"));
        assert_ne!(h1, h2);
    }

    #[test]
    fn hash_path_is_stable() {
        let h1 = hash_path(Path::new("/x/y.html"));
        let h2 = hash_path(Path::new("/x/y.html"));
        assert_eq!(h1, h2);
    }

    #[test]
    fn hash_path_is_hex_16_chars() {
        let h = hash_path(Path::new("/some/path.html"));
        assert_eq!(h.len(), 16);
        assert!(h.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn corrupt_json_falls_back_to_defaults() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("file_viewer_prefs.json");
        std::fs::write(&path, b"{not valid json!!!").unwrap();
        let prefs = load_prefs_at(&path);
        assert!(prefs.entries.is_empty());
    }

    #[test]
    fn missing_file_returns_default() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("file_viewer_prefs.json");
        let prefs = load_prefs_at(&path);
        assert!(prefs.entries.is_empty());
    }

    #[test]
    fn roundtrip_set_then_get() {
        let dir = tempdir().unwrap();
        let prefs_path = dir.path().join("prefs.json");
        // Create a real file to canonicalize
        let target = dir.path().join("test.html");
        std::fs::write(&target, b"<h1>hi</h1>").unwrap();

        set_pref_at(&prefs_path, &target, true).unwrap();
        let pref = get_pref_at(&prefs_path, &target);
        assert!(pref.is_some());
        assert!(pref.unwrap().allow_images);

        // Toggle off
        set_pref_at(&prefs_path, &target, false).unwrap();
        let pref = get_pref_at(&prefs_path, &target);
        assert!(!pref.unwrap().allow_images);
    }

    #[test]
    fn lru_eviction_at_500_entries() {
        let mut prefs = FileViewerPrefs::default();
        // Insert 505 entries with ascending timestamps
        for i in 0..505 {
            prefs.entries.insert(
                format!("{:016x}", i),
                FileViewerPrefEntry {
                    allow_images: true,
                    last_accessed: i as u64,
                },
            );
        }
        assert_eq!(prefs.entries.len(), 505);
        evict_lru(&mut prefs);
        assert_eq!(prefs.entries.len(), MAX_ENTRIES);
        // The 5 oldest (ts 0..4) should have been evicted
        for i in 0..5 {
            assert!(
                !prefs.entries.contains_key(&format!("{:016x}", i)),
                "entry {} should have been evicted",
                i
            );
        }
        // Entry 5 should survive
        assert!(prefs.entries.contains_key(&format!("{:016x}", 5)));
    }

    #[test]
    fn get_returns_none_for_unknown_path() {
        let dir = tempdir().unwrap();
        let prefs_path = dir.path().join("prefs.json");
        let target = dir.path().join("no-such.html");
        let pref = get_pref_at(&prefs_path, &target);
        // Path doesn't exist, so canonicalize fails → None
        assert!(pref.is_none());
    }
}
