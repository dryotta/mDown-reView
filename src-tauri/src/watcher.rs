use crate::core::paths::canonicalize_no_verbatim;
use notify_debouncer_mini::{new_debouncer, DebouncedEventKind};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

/// Maximum number of tree-watched dirs across ALL windows (merged union).
pub const MAX_TREE_WATCHED_DIRS: usize = 1024;

/// Per-workspace `.mrsf.yaml` configuration cache.
/// Maps canonical workspace root → `Option<PathBuf>` (the `sidecar_root` value).
/// `None` value means either no `.mrsf.yaml` exists or it has no `sidecar_root`.
pub struct SidecarConfigState {
    configs: Arc<Mutex<HashMap<PathBuf, Option<PathBuf>>>>,
}

impl SidecarConfigState {
    pub fn new() -> Self {
        Self {
            configs: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Look up the sidecar config for a file path by finding which workspace root it belongs to.
    /// Returns `(workspace_root, sidecar_root)` if a workspace matches.
    /// When multiple workspace roots match (nested workspaces), the longest
    /// (most specific) root wins.
    pub fn resolve_for_file(&self, file_path: &Path) -> Option<(PathBuf, Option<PathBuf>)> {
        let guard = self.configs.lock().ok()?;
        let canonical = canonicalize_no_verbatim(file_path).ok()?;
        guard
            .iter()
            .filter(|(root, _)| canonical.starts_with(root))
            .max_by_key(|(root, _)| root.components().count())
            .map(|(root, config)| (root.clone(), config.clone()))
    }

    /// Register or update the config for a workspace root.
    pub fn set_config(&self, workspace_root: PathBuf, sidecar_root: Option<PathBuf>) {
        if let Ok(mut guard) = self.configs.lock() {
            guard.insert(workspace_root, sidecar_root);
        }
    }

    /// Remove config for a workspace root.
    pub fn remove_config(&self, workspace_root: &Path) {
        if let Ok(mut guard) = self.configs.lock() {
            guard.remove(workspace_root);
        }
    }
}

pub struct WatcherState {
    /// Per-window watched file paths (keyed by window label).
    watched_paths: Arc<Mutex<HashMap<String, HashSet<PathBuf>>>>,
    /// Per-window tree-watched dirs (keyed by window label).
    tree_watched_dirs: Arc<Mutex<HashMap<String, HashSet<PathBuf>>>>,
    /// Sending on this channel wakes the watcher thread to sync dirs immediately.
    sync_tx: std::sync::mpsc::SyncSender<()>,
}

impl WatcherState {
    pub fn new(sync_tx: std::sync::mpsc::SyncSender<()>) -> Self {
        Self {
            watched_paths: Arc::new(Mutex::new(HashMap::new())),
            tree_watched_dirs: Arc::new(Mutex::new(HashMap::new())),
            sync_tx,
        }
    }

    /// Remove all watcher entries for a destroyed window.
    pub fn remove_window(&self, window_label: &str) {
        if let Ok(mut guard) = self.tree_watched_dirs.lock() {
            guard.remove(window_label);
        }
        if let Ok(mut guard) = self.watched_paths.lock() {
            guard.remove(window_label);
        }
        let _ = self.sync_tx.try_send(());
    }

    /// Defense-in-depth allowlist for system-level commands (open / reveal):
    /// a path is considered "known to the user" if it is either currently
    /// open in a tab (`watched_paths`) or sits inside an open workspace folder
    /// (`tree_watched_dirs`). Both lookups operate on canonical forms so a
    /// symlink trick cannot escape the workspace boundary.
    ///
    /// Returns `false` for paths that fail to canonicalize (deleted files,
    /// permission errors) — callers should fail closed.
    pub fn is_path_allowed(&self, path: &Path) -> bool {
        let canonical = match canonicalize_no_verbatim(path) {
            Ok(c) => c,
            Err(_) => return false,
        };
        if let Ok(watched) = self.watched_paths.lock() {
            for set in watched.values() {
                if set.contains(&canonical) {
                    return true;
                }
            }
        }
        if let Ok(dirs) = self.tree_watched_dirs.lock() {
            for set in dirs.values() {
                for dir in set.iter() {
                    if canonical.starts_with(dir) {
                        return true;
                    }
                }
            }
        }
        false
    }

    /// Same as [`Self::is_path_allowed`] but ALSO accepts paths whose file
    /// component does not exist — as long as the path's parent directory
    /// canonicalizes inside an open workspace folder. This is the variant
    /// every comment-mutation command must use: editor saves, OneDrive sync,
    /// and the orphan-comment / DeletedFileViewer flow all routinely produce
    /// requests against paths that have just been deleted, renamed, or
    /// swapped under us, and rejecting those would silently break sidecar
    /// writes against those files.
    ///
    /// Symlink safety still holds: the parent's canonical form is compared
    /// against the watched dirs, so a symlink whose parent points outside
    /// the workspace cannot smuggle through.
    pub fn is_path_or_parent_allowed(&self, path: &Path) -> bool {
        if self.is_path_allowed(path) {
            return true;
        }
        let parent = match path.parent() {
            Some(p) if !p.as_os_str().is_empty() => p,
            _ => return false,
        };
        let canonical_parent = match canonicalize_no_verbatim(parent) {
            Ok(c) => c,
            Err(_) => return false,
        };
        if let Ok(dirs) = self.tree_watched_dirs.lock() {
            for set in dirs.values() {
                for dir in set.iter() {
                    if canonical_parent.starts_with(dir) {
                        return true;
                    }
                }
            }
        }
        false
    }

    /// Replace the set of tree-watched dirs after validating each entry.
    /// Inputs are canonicalized internally — frontend may pass any absolute
    /// form (Windows `C:\...` or Unix `/...`); we normalize to the OS canonical
    /// form (e.g. `\\?\C:\...` on Windows) before storing.
    pub fn set_tree_watched_dirs(&self, window_label: &str, root: String, dirs: Vec<String>) -> Result<(), String> {
        if dirs.len() > MAX_TREE_WATCHED_DIRS {
            return Err(format!(
                "too many dirs: {} (max {})",
                dirs.len(),
                MAX_TREE_WATCHED_DIRS
            ));
        }
        let canonical_root = canonicalize_no_verbatim(Path::new(&root))
            .map_err(|e| format!("invalid root {}: {}", root, e))?;
        if !canonical_root.is_dir() {
            return Err(format!("root is not a directory: {}", root));
        }

        let mut new_set: HashSet<PathBuf> = HashSet::with_capacity(dirs.len());
        for d in &dirs {
            let canonical = canonicalize_no_verbatim(Path::new(d))
                .map_err(|e| format!("invalid dir {}: {}", d, e))?;
            if !canonical.is_dir() {
                return Err(format!("not a directory: {}", d));
            }
            if !canonical.starts_with(&canonical_root) {
                return Err(format!("dir outside root: {}", d));
            }
            new_set.insert(canonical);
        }

        let mut guard = self
            .tree_watched_dirs
            .lock()
            .map_err(|e| format!("tree_watched_dirs lock poisoned: {}", e))?;
        let others_count: usize = guard
            .iter()
            .filter(|(k, _)| k.as_str() != window_label)
            .map(|(_, v)| v.len())
            .sum();
        if others_count + new_set.len() > MAX_TREE_WATCHED_DIRS {
            return Err(format!(
                "too many dirs across all windows: {} + {} (max {})",
                others_count,
                new_set.len(),
                MAX_TREE_WATCHED_DIRS
            ));
        }
        guard.insert(window_label.to_string(), new_set);
        drop(guard);

        // Wake watcher thread to (un)register dirs immediately.
        let _ = self.sync_tx.try_send(());
        Ok(())
    }
}

/// Event payload sent to the frontend
#[derive(Clone, serde::Serialize)]
pub struct FileChangeEvent {
    pub path: String,
    pub kind: String, // "content" | "review" | "deleted"
}

/// Event payload for `folder-changed`: the canonical directory whose listing changed.
#[derive(Clone, serde::Serialize)]
pub struct FolderChangeEvent {
    pub path: String,
}

/// Wrapper so AppHandle can store the receiver end of the sync channel.
/// The `Option` lets `start_watcher` take exclusive ownership via `.take()`.
pub struct SyncRx(pub Mutex<Option<std::sync::mpsc::Receiver<()>>>);

/// Start the file watcher. Should be called once during app setup.
pub fn start_watcher(app: &AppHandle) {
    let state = app.state::<WatcherState>();
    let watched = Arc::clone(&state.watched_paths);
    let tree_watched = Arc::clone(&state.tree_watched_dirs);
    let app_handle = app.clone();

    // Take the sync_rx out of managed state — the watcher thread owns it exclusively.
    let sync_rx = match app.state::<SyncRx>().inner().0.lock() {
        Err(_) => {
            tracing::error!("[watcher] sync_rx mutex poisoned; aborting watcher");
            return;
        }
        Ok(mut g) => match g.take() {
            Some(rx) => rx,
            None => {
                tracing::error!("[watcher] start_watcher called more than once; aborting");
                return;
            }
        },
    };

    std::thread::spawn(move || {
        let (tx, rx) = std::sync::mpsc::channel();

        let mut debouncer = match new_debouncer(Duration::from_millis(300), tx) {
            Ok(d) => d,
            Err(e) => {
                tracing::error!("[watcher] failed to create debouncer: {}", e);
                return;
            }
        };

        let mut watched_dirs: HashSet<PathBuf> = HashSet::new();

        loop {
            // Process debounced file-change events (200ms timeout for responsiveness).
            match rx.recv_timeout(Duration::from_millis(200)) {
                Ok(Ok(events)) => {
                    let current_watched = lock_watched_union(&watched);
                    let current_tree = lock_watched_union(&tree_watched);
                    // De-dup folder-changed emissions per debounced batch.
                    let mut folder_dirs: HashSet<PathBuf> = HashSet::new();
                    for event in events {
                        if event.kind != DebouncedEventKind::Any {
                            continue;
                        }
                        let (file_event, folder_dir) =
                            classify_event(&event.path, &current_watched, &current_tree);
                        if let Some(ev) = file_event {
                            tracing::debug!("[watcher] file change: {} ({})", ev.path, ev.kind);
                            let _ = app_handle.emit("file-changed", ev);
                        }
                        if let Some(d) = folder_dir {
                            folder_dirs.insert(d);
                        }
                    }
                    for dir in folder_dirs {
                        let path_str = dir.to_string_lossy().into_owned();
                        tracing::debug!("[watcher] folder change: {}", path_str);
                        let _ = app_handle.emit(
                            "folder-changed",
                            FolderChangeEvent { path: path_str },
                        );
                    }
                }
                Ok(Err(e)) => {
                    tracing::warn!("[watcher] notify error: {}", e);
                }
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                    tracing::info!("[watcher] channel disconnected, stopping");
                    break;
                }
            }

            // Drain sync signals AFTER recv_timeout so signals posted during the
            // 200ms block are caught immediately on this iteration, not the next.
            let mut needs_sync = false;
            while sync_rx.try_recv().is_ok() {
                needs_sync = true;
            }

            if needs_sync {
                sync_dirs(&watched, &tree_watched, &mut watched_dirs, &mut debouncer);
            }
        }
    });
}

fn lock_watched_union(watched: &Arc<Mutex<HashMap<String, HashSet<PathBuf>>>>) -> HashSet<PathBuf> {
    match watched.lock() {
        Ok(g) => g.values().flat_map(|s| s.iter().cloned()).collect(),
        Err(p) => {
            tracing::warn!("[watcher] mutex poisoned, recovering");
            p.into_inner()
                .values()
                .flat_map(|s| s.iter().cloned())
                .collect()
        }
    }
}

fn sync_dirs(
    watched: &Arc<Mutex<HashMap<String, HashSet<PathBuf>>>>,
    tree_watched: &Arc<Mutex<HashMap<String, HashSet<PathBuf>>>>,
    watched_dirs: &mut HashSet<PathBuf>,
    debouncer: &mut notify_debouncer_mini::Debouncer<notify::RecommendedWatcher>,
) {
    let current_watched = lock_watched_union(watched);
    let current_tree = lock_watched_union(tree_watched);
    let mut needed: HashSet<PathBuf> = current_watched
        .iter()
        .filter_map(|p| p.parent().map(|d| d.to_path_buf()))
        .collect();
    // Tree-watched dirs themselves must be observed (non-recursive) so we get
    // events for direct children added/removed/renamed.
    needed.extend(current_tree.iter().cloned());

    for dir in &needed {
        if !watched_dirs.contains(dir) && dir.exists() {
            if let Err(e) = debouncer
                .watcher()
                .watch(dir, notify::RecursiveMode::NonRecursive)
            {
                tracing::warn!("[watcher] failed to watch {:?}: {}", dir, e);
            } else {
                tracing::debug!("[watcher] watching dir: {:?}", dir);
                watched_dirs.insert(dir.clone());
            }
        }
    }

    let stale: Vec<PathBuf> = watched_dirs.difference(&needed).cloned().collect();
    for dir in stale {
        let _ = debouncer.watcher().unwatch(&dir);
        watched_dirs.remove(&dir);
        tracing::debug!("[watcher] unwatched dir: {:?}", dir);
    }
}

/// Tauri command: update the set of watched file paths.
/// The frontend calls this whenever the set of open tabs changes.
#[tauri::command]
pub fn update_watched_files(
    window: tauri::Window,
    paths: Vec<String>,
    state: tauri::State<'_, WatcherState>,
) -> Result<(), String> {
    let window_label = window.label().to_string();
    let mut watched = state.watched_paths.lock().map_err(|e| e.to_string())?;
    let set = watched.entry(window_label).or_default();
    set.clear();

    for path_str in &paths {
        let path = PathBuf::from(path_str);
        if let Ok(canonical) = canonicalize_no_verbatim(&path) {
            set.insert(canonical);
        }
        // Always store the raw path too — on deletion, canonicalize fails
        // and the notify crate may report the non-canonical form.
        set.insert(path.clone());
        // Also watch sidecars
        for ext in &[".review.yaml", ".review.json"] {
            let sidecar = PathBuf::from(format!("{}{}", path_str, ext));
            if let Ok(canonical) = canonicalize_no_verbatim(&sidecar) {
                set.insert(canonical);
            }
            set.insert(sidecar);
        }
    }

    tracing::debug!("[watcher] updated watched files: {} paths", set.len());
    // Signal the watcher thread to sync dirs immediately (non-blocking: drop if full).
    let _ = state.sync_tx.try_send(());
    Ok(())
}

/// Classify a single notify event for emission to the frontend.
///
/// Returns `(file-changed payload?, folder-changed dir?)`.
/// - `file-changed` fires when the (canonical or raw) path is in `watched_paths`.
/// - `folder-changed` fires when the canonical parent dir is in `tree_dirs`.
///   The returned `PathBuf` is the *canonical* dir from the set (never the raw
///   notify path) so the frontend always sees a stable, canonical path string.
pub(crate) fn classify_event(
    path: &Path,
    watched_paths: &HashSet<PathBuf>,
    tree_dirs: &HashSet<PathBuf>,
) -> (Option<FileChangeEvent>, Option<PathBuf>) {
    let canonical = canonicalize_no_verbatim(path).ok();

    // file-changed: match against watched_paths.
    let file_event = {
        let canonical_match = canonical
            .as_ref()
            .map(|c| watched_paths.contains(c))
            .unwrap_or(false);
        if canonical_match || watched_paths.contains(path) {
            let path_str = path.to_string_lossy().to_string();
            let is_review =
                path_str.ends_with(".review.yaml") || path_str.ends_with(".review.json");
            let exists = path.exists();
            let kind = match (is_review, exists) {
                (_, false) => "deleted",
                (true, true) => "review",
                (false, true) => "content",
            };
            Some(FileChangeEvent {
                path: path_str,
                kind: kind.to_string(),
            })
        } else {
            None
        }
    };

    // folder-changed: parent of canonical (preferred) or raw path must be in tree_dirs.
    // We return the matched entry from the set so the emitted path is canonical.
    let folder_dir = {
        let parent = canonical
            .as_ref()
            .and_then(|c| c.parent())
            .map(|p| p.to_path_buf())
            .or_else(|| path.parent().map(|p| p.to_path_buf()));
        parent.and_then(|p| tree_dirs.get(&p).cloned())
    };

    (file_event, folder_dir)
}

#[cfg(test)]
#[path = "watcher_tests.rs"]
mod tests;
