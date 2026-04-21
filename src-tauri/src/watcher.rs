use notify_debouncer_mini::{new_debouncer, DebouncedEventKind};
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

/// State shared between the watcher thread and Tauri commands
pub struct WatcherState {
    /// Paths currently being watched (includes both source files and sidecars)
    watched_paths: Arc<Mutex<HashSet<PathBuf>>>,
}

impl WatcherState {
    pub fn new() -> Self {
        Self {
            watched_paths: Arc::new(Mutex::new(HashSet::new())),
        }
    }
}

/// Event payload sent to the frontend
#[derive(Clone, serde::Serialize)]
pub struct FileChangeEvent {
    pub path: String,
    pub kind: String, // "content" | "review" | "deleted"
}

/// Start the file watcher. Should be called once during app setup.
pub fn start_watcher(app: &AppHandle) {
    let state = app.state::<WatcherState>();
    let watched = Arc::clone(&state.watched_paths);
    let app_handle = app.clone();

    std::thread::spawn(move || {
        let (tx, rx) = std::sync::mpsc::channel();

        // Create debouncer with 300ms delay
        let mut debouncer = match new_debouncer(Duration::from_millis(300), tx) {
            Ok(d) => d,
            Err(e) => {
                tracing::error!("[watcher] failed to create debouncer: {}", e);
                return;
            }
        };

        // Watch the entire filesystem root isn't practical, so we use a polling approach:
        // We keep track of which directories contain watched files and watch those.
        let mut watched_dirs: HashSet<PathBuf> = HashSet::new();

        loop {
            // Check for debounced events
            match rx.recv_timeout(Duration::from_millis(500)) {
                Ok(Ok(events)) => {
                    let current_watched = match watched.lock() {
                        Ok(guard) => guard.clone(),
                        Err(poisoned) => {
                            tracing::warn!("[watcher] mutex poisoned, recovering");
                            poisoned.into_inner().clone()
                        }
                    };
                    for event in events {
                        if event.kind != DebouncedEventKind::Any {
                            continue;
                        }
                        let path = &event.path;
                        let canonical = match std::fs::canonicalize(path) {
                            Ok(p) => p,
                            Err(_) => path.clone(), // file may have been deleted
                        };

                        if current_watched.contains(&canonical) || current_watched.contains(path) {
                            let path_str = path.to_string_lossy().to_string();
                            let is_review = path_str.ends_with(".review.yaml") || path_str.ends_with(".review.json");
                            let exists = path.exists();
                            let kind = match (is_review, exists) {
                                (_, false) => "deleted",
                                (true, true) => "review",
                                (false, true) => "content",
                            };
                            let event = FileChangeEvent {
                                path: path_str,
                                kind: kind.to_string(),
                            };
                            tracing::debug!("[watcher] file change: {} ({})", event.path, event.kind);
                            let _ = app_handle.emit("file-changed", event);
                        }
                    }
                }
                Ok(Err(error)) => {
                    tracing::warn!("[watcher] notify error: {}", error);
                }
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                    // Normal timeout, check if we need to update watched dirs
                }
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                    tracing::info!("[watcher] channel disconnected, stopping");
                    break;
                }
            }

            // Sync watched directories with current watched paths
            let current_watched = match watched.lock() {
                Ok(guard) => guard.clone(),
                Err(poisoned) => {
                    tracing::warn!("[watcher] mutex poisoned, recovering");
                    poisoned.into_inner().clone()
                }
            };
            let needed_dirs: HashSet<PathBuf> = current_watched
                .iter()
                .filter_map(|p| p.parent().map(|d| d.to_path_buf()))
                .collect();

            // Add new directories
            for dir in &needed_dirs {
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

            // Remove stale directories
            let stale: Vec<PathBuf> = watched_dirs.difference(&needed_dirs).cloned().collect();
            for dir in stale {
                let _ = debouncer.watcher().unwatch(&dir);
                watched_dirs.remove(&dir);
                tracing::debug!("[watcher] unwatched dir: {:?}", dir);
            }
        }
    });
}

/// Tauri command: update the set of watched file paths.
/// The frontend calls this whenever the set of open tabs changes.
#[tauri::command]
pub fn update_watched_files(
    paths: Vec<String>,
    state: tauri::State<'_, WatcherState>,
) -> Result<(), String> {
    let mut watched = state.watched_paths.lock().map_err(|e| e.to_string())?;
    watched.clear();

    for path_str in &paths {
        let path = PathBuf::from(path_str);
        // Watch the file itself
        if let Ok(canonical) = std::fs::canonicalize(&path) {
            watched.insert(canonical);
        } else {
            watched.insert(path.clone());
        }
        // Also watch its review sidecars (YAML primary, JSON fallback)
        let sidecar_yaml = PathBuf::from(format!("{}.review.yaml", path_str));
        if let Ok(canonical) = std::fs::canonicalize(&sidecar_yaml) {
            watched.insert(canonical);
        } else {
            watched.insert(sidecar_yaml);
        }
        let sidecar_json = PathBuf::from(format!("{}.review.json", path_str));
        if let Ok(canonical) = std::fs::canonicalize(&sidecar_json) {
            watched.insert(canonical);
        } else {
            watched.insert(sidecar_json);
        }
    }

    tracing::debug!("[watcher] updated watched files: {} paths", watched.len());
    Ok(())
}
