//! Window registry for multi-window support.
//!
//! Tracks open windows, their associated folders (or file-only status), and
//! provides routing decisions for incoming open requests so the app can reuse
//! or focus existing windows instead of spawning duplicates.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

// ---------------------------------------------------------------------------
// Path comparison helpers
// ---------------------------------------------------------------------------

/// Case-insensitive on Windows, exact on other platforms.
fn paths_equal(a: &Path, b: &Path) -> bool {
    if cfg!(windows) {
        // Compare the full OsStr case-insensitively via Unicode lowering.
        a.as_os_str()
            .to_string_lossy()
            .eq_ignore_ascii_case(&b.as_os_str().to_string_lossy())
    } else {
        a == b
    }
}

/// Returns `true` when every component of `parent` matches the corresponding
/// leading component of `child` (case-insensitive on Windows).
fn is_ancestor(parent: &Path, child: &Path) -> bool {
    let parent_components: Vec<_> = parent.components().collect();
    let child_components: Vec<_> = child.components().collect();

    if parent_components.len() >= child_components.len() {
        return false;
    }

    for (p, c) in parent_components.iter().zip(child_components.iter()) {
        let p_str = p.as_os_str().to_string_lossy();
        let c_str = c.as_os_str().to_string_lossy();

        let equal = if cfg!(windows) {
            p_str.eq_ignore_ascii_case(&c_str)
        } else {
            p_str == c_str
        };

        if !equal {
            return false;
        }
    }

    true
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/// What kind of content a window holds.
#[derive(Debug, Clone)]
pub enum WindowKind {
    /// A folder-rooted window showing all files under `path`.
    Folder(PathBuf),
    /// A window that holds orphan files not belonging to any folder.
    FileOnly,
}

/// A registered window entry.
#[derive(Debug, Clone)]
pub struct WindowEntry {
    pub label: String,
    pub kind: WindowKind,
}

/// Decision returned by `route_folder` / `route_file`.
#[derive(Debug, Clone)]
pub enum RouteDecision {
    /// An existing window already owns this content — focus it.
    FocusExisting(String),
    /// Route files as tabs into an existing window.
    AddToWindow {
        label: String,
        files: Vec<PathBuf>,
    },
    /// Create a new folder-rooted window.
    CreateFolder {
        path: PathBuf,
    },
    /// Create a new file-only window with these files.
    CreateFileOnly {
        files: Vec<PathBuf>,
    },
}

// ---------------------------------------------------------------------------
// WindowRegistry
// ---------------------------------------------------------------------------

/// Thread-safe registry of all open windows.
///
/// Designed to be used as Tauri managed state via `app.manage(WindowRegistry::default())`.
#[derive(Debug)]
pub struct WindowRegistry {
    entries: Mutex<Vec<WindowEntry>>,
    counter: AtomicU64,
}

impl Default for WindowRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl WindowRegistry {
    /// Create an empty registry.
    pub fn new() -> Self {
        Self {
            entries: Mutex::new(Vec::new()),
            counter: AtomicU64::new(1),
        }
    }

    /// Register a new window.
    pub fn register(&self, label: String, kind: WindowKind) {
        let mut entries = self.entries.lock().expect("registry lock poisoned");
        entries.push(WindowEntry { label, kind });
    }

    /// Update the kind of an existing window entry.
    pub fn update_kind(&self, label: &str, kind: WindowKind) {
        let mut entries = self.entries.lock().expect("registry lock poisoned");
        if let Some(entry) = entries.iter_mut().find(|e| e.label == label) {
            entry.kind = kind;
        }
    }

    /// Remove a window by label.
    pub fn unregister(&self, label: &str) {
        let mut entries = self.entries.lock().expect("registry lock poisoned");
        entries.retain(|e| e.label != label);
    }

    /// Find the label of the `Folder` window whose path matches `path`.
    ///
    /// On Windows the comparison is case-insensitive.
    pub fn find_by_folder(&self, path: &Path) -> Option<String> {
        let entries = self.entries.lock().expect("registry lock poisoned");
        entries.iter().find_map(|e| match &e.kind {
            WindowKind::Folder(p) if paths_equal(p, path) => Some(e.label.clone()),
            _ => None,
        })
    }

    /// Find the label of the first `FileOnly` window, if any.
    pub fn find_file_only(&self) -> Option<String> {
        let entries = self.entries.lock().expect("registry lock poisoned");
        entries.iter().find_map(|e| match &e.kind {
            WindowKind::FileOnly => Some(e.label.clone()),
            _ => None,
        })
    }

    /// Find the label of the `Folder` window whose path is the deepest
    /// ancestor of `file_path`. On Windows the comparison is case-insensitive.
    ///
    /// When multiple open folders are ancestors (e.g. `/projects` and
    /// `/projects/myapp`), the most-specific (longest path) wins so files
    /// route to the tightest enclosing folder window.
    pub fn find_ancestor_folder(&self, file_path: &Path) -> Option<String> {
        let entries = self.entries.lock().expect("registry lock poisoned");
        let mut best: Option<(usize, &str)> = None;
        for entry in entries.iter() {
            if let WindowKind::Folder(p) = &entry.kind {
                if is_ancestor(p, file_path) {
                    let depth = p.components().count();
                    if best.map_or(true, |(d, _)| depth > d) {
                        best = Some((depth, &entry.label));
                    }
                }
            }
        }
        best.map(|(_, label)| label.to_string())
    }

    /// Decide how to handle an incoming folder-open request.
    ///
    /// - If the folder is already open → `FocusExisting`.
    /// - Otherwise → `CreateFolder`.
    pub fn route_folder(&self, folder: &Path) -> RouteDecision {
        if let Some(label) = self.find_by_folder(folder) {
            RouteDecision::FocusExisting(label)
        } else {
            RouteDecision::CreateFolder {
                path: folder.to_path_buf(),
            }
        }
    }

    /// Decide how to handle an incoming file-open request.
    ///
    /// - If the file is under an already-open folder → `AddToWindow` (to that
    ///   folder window).
    /// - If a `FileOnly` window exists → `AddToWindow` (to that window).
    /// - Otherwise → `CreateFileOnly`.
    pub fn route_file(&self, file: &Path) -> RouteDecision {
        if let Some(label) = self.find_ancestor_folder(file) {
            RouteDecision::AddToWindow {
                label,
                files: vec![file.to_path_buf()],
            }
        } else if let Some(label) = self.find_file_only() {
            RouteDecision::AddToWindow {
                label,
                files: vec![file.to_path_buf()],
            }
        } else {
            RouteDecision::CreateFileOnly {
                files: vec![file.to_path_buf()],
            }
        }
    }

    /// Generate the next unique window label (`win-1`, `win-2`, …).
    pub fn next_label(&self) -> String {
        let n = self.counter.fetch_add(1, Ordering::Relaxed);
        format!("win-{n}")
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn register_folder_then_find() {
        let reg = WindowRegistry::new();
        reg.register("w1".into(), WindowKind::Folder(PathBuf::from("/projects/a")));

        assert_eq!(
            reg.find_by_folder(Path::new("/projects/a")),
            Some("w1".into())
        );
    }

    #[test]
    fn register_two_folders_independent() {
        let reg = WindowRegistry::new();
        reg.register("w1".into(), WindowKind::Folder(PathBuf::from("/a")));
        reg.register("w2".into(), WindowKind::Folder(PathBuf::from("/b")));

        assert_eq!(reg.find_by_folder(Path::new("/a")), Some("w1".into()));
        assert_eq!(reg.find_by_folder(Path::new("/b")), Some("w2".into()));
    }

    #[test]
    fn unregister_removes_entry() {
        let reg = WindowRegistry::new();
        reg.register("w1".into(), WindowKind::Folder(PathBuf::from("/a")));
        reg.unregister("w1");

        assert_eq!(reg.find_by_folder(Path::new("/a")), None);
    }

    #[test]
    fn find_file_only_ignores_folders() {
        let reg = WindowRegistry::new();
        reg.register("f1".into(), WindowKind::Folder(PathBuf::from("/a")));
        reg.register("fo".into(), WindowKind::FileOnly);

        assert_eq!(reg.find_file_only(), Some("fo".into()));
    }

    #[test]
    fn find_ancestor_folder() {
        let reg = WindowRegistry::new();
        reg.register(
            "w1".into(),
            WindowKind::Folder(PathBuf::from("/projects/myapp")),
        );

        assert_eq!(
            reg.find_ancestor_folder(Path::new("/projects/myapp/src/main.rs")),
            Some("w1".into())
        );
        // Not an ancestor of a sibling folder.
        assert_eq!(
            reg.find_ancestor_folder(Path::new("/projects/other/foo.rs")),
            None
        );
    }

    #[test]
    fn route_folder_existing_focus() {
        let reg = WindowRegistry::new();
        reg.register("w1".into(), WindowKind::Folder(PathBuf::from("/a")));

        match reg.route_folder(Path::new("/a")) {
            RouteDecision::FocusExisting(label) => assert_eq!(label, "w1"),
            other => panic!("expected FocusExisting, got {other:?}"),
        }
    }

    #[test]
    fn route_folder_new_creates() {
        let reg = WindowRegistry::new();

        match reg.route_folder(Path::new("/new")) {
            RouteDecision::CreateFolder { path } => assert_eq!(path, PathBuf::from("/new")),
            other => panic!("expected CreateFolder, got {other:?}"),
        }
    }

    #[test]
    fn route_file_inside_open_folder() {
        let reg = WindowRegistry::new();
        reg.register("w1".into(), WindowKind::Folder(PathBuf::from("/proj")));

        match reg.route_file(Path::new("/proj/src/lib.rs")) {
            RouteDecision::AddToWindow { label, files } => {
                assert_eq!(label, "w1");
                assert_eq!(files, vec![PathBuf::from("/proj/src/lib.rs")]);
            }
            other => panic!("expected AddToWindow, got {other:?}"),
        }
    }

    #[test]
    fn route_file_orphan_with_file_only() {
        let reg = WindowRegistry::new();
        reg.register("fo".into(), WindowKind::FileOnly);

        match reg.route_file(Path::new("/random/file.md")) {
            RouteDecision::AddToWindow { label, files } => {
                assert_eq!(label, "fo");
                assert_eq!(files, vec![PathBuf::from("/random/file.md")]);
            }
            other => panic!("expected AddToWindow (file-only), got {other:?}"),
        }
    }

    #[test]
    fn route_file_orphan_no_file_only() {
        let reg = WindowRegistry::new();

        match reg.route_file(Path::new("/random/file.md")) {
            RouteDecision::CreateFileOnly { files } => {
                assert_eq!(files, vec![PathBuf::from("/random/file.md")]);
            }
            other => panic!("expected CreateFileOnly, got {other:?}"),
        }
    }

    #[test]
    fn case_insensitive_path_comparison_windows() {
        // paths_equal
        let a = Path::new("C:\\Users\\Dev\\Project");
        let b = Path::new("c:\\users\\dev\\project");

        if cfg!(windows) {
            assert!(paths_equal(a, b), "Windows paths should be case-insensitive");
        } else {
            // On non-Windows these are genuinely different paths.
            assert!(!paths_equal(a, b));
        }
    }

    #[test]
    fn case_insensitive_ancestor_windows() {
        if cfg!(windows) {
            let parent = Path::new("C:\\Users\\Dev\\Project");
            let child = Path::new("C:\\Users\\Dev\\Project\\src\\main.rs");
            assert!(is_ancestor(parent, child));
            // Also with different casing.
            let child_lower = Path::new("c:\\users\\dev\\project\\src\\main.rs");
            assert!(
                is_ancestor(parent, child_lower),
                "ancestor check should be case-insensitive on Windows"
            );
        } else {
            // On Linux/macOS, use forward-slash paths (backslash is not a separator).
            let parent = Path::new("/users/dev/project");
            let child = Path::new("/users/dev/project/src/main.rs");
            assert!(is_ancestor(parent, child));
        }
    }

    #[test]
    fn update_kind_changes_existing_entry() {
        let reg = WindowRegistry::new();
        reg.register("main".to_string(), WindowKind::FileOnly);
        assert!(reg.find_file_only().is_some());
        reg.update_kind("main", WindowKind::Folder(PathBuf::from("/projects/myapp")));
        assert!(reg.find_file_only().is_none());
        assert!(reg.find_by_folder(Path::new("/projects/myapp")).is_some());
    }

    #[test]
    fn update_kind_noop_for_unknown_label() {
        let reg = WindowRegistry::new();
        reg.register("w1".to_string(), WindowKind::FileOnly);
        reg.update_kind("unknown", WindowKind::Folder(PathBuf::from("/a")));
        // w1 should remain FileOnly
        assert!(reg.find_file_only().is_some());
    }

    #[test]
    fn next_label_increments() {
        let reg = WindowRegistry::new();
        assert_eq!(reg.next_label(), "win-1");
        assert_eq!(reg.next_label(), "win-2");
        assert_eq!(reg.next_label(), "win-3");
    }

    #[test]
    fn nested_folders_routes_to_deepest() {
        let reg = WindowRegistry::new();
        reg.register("outer".into(), WindowKind::Folder(PathBuf::from("/projects")));
        reg.register(
            "inner".into(),
            WindowKind::Folder(PathBuf::from("/projects/myapp")),
        );

        // File under /projects/myapp should route to "inner", not "outer".
        assert_eq!(
            reg.find_ancestor_folder(Path::new("/projects/myapp/src/lib.rs")),
            Some("inner".into())
        );
        // File under /projects but NOT under /projects/myapp routes to "outer".
        assert_eq!(
            reg.find_ancestor_folder(Path::new("/projects/other/readme.md")),
            Some("outer".into())
        );
    }

    #[test]
    fn is_ancestor_same_path_returns_false() {
        // A path is not its own ancestor (parent must be strictly shorter).
        assert!(!is_ancestor(Path::new("/a/b"), Path::new("/a/b")));
    }

    #[test]
    fn duplicate_label_register_keeps_both() {
        let reg = WindowRegistry::new();
        reg.register("w1".into(), WindowKind::Folder(PathBuf::from("/a")));
        reg.register("w1".into(), WindowKind::Folder(PathBuf::from("/b")));

        // Both folders are findable (first match for /a, second for /b).
        assert_eq!(reg.find_by_folder(Path::new("/a")), Some("w1".into()));
        assert_eq!(reg.find_by_folder(Path::new("/b")), Some("w1".into()));

        // Unregister removes all entries with that label.
        reg.unregister("w1");
        assert_eq!(reg.find_by_folder(Path::new("/a")), None);
        assert_eq!(reg.find_by_folder(Path::new("/b")), None);
    }
}
