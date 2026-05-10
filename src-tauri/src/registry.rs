//! Window registry for multi-window support.
//!
//! Tracks open windows, their associated folders (or file-only status), and
//! provides routing decisions for incoming open requests so the app can reuse
//! or focus existing windows instead of spawning duplicates.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use crate::core::types::LaunchArgs;

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
    /// Claim the folder for an existing `FileOnly` window (the drag-drop
    /// target the user gestured at). Returned only by
    /// `route_folder_for_target` — never by the un-targeted
    /// [`WindowRegistry::route_folder`]. The caller (`route_args_to_window`)
    /// performs the atomic `try_claim_folder` and emits the
    /// `args-received` signal so the renderer's
    /// `useLaunchArgsBootstrap` drains the queued folder via the
    /// existing chokepoint.
    ClaimForTarget {
        target_label: String,
        path: PathBuf,
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
    pending_args: Mutex<HashMap<String, Vec<LaunchArgs>>>,
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
            pending_args: Mutex::new(HashMap::new()),
            counter: AtomicU64::new(1),
        }
    }

    /// Register a new window.
    pub fn register(&self, label: String, kind: WindowKind) {
        let mut entries = self.entries.lock().expect("registry lock poisoned");
        entries.push(WindowEntry { label, kind });
    }

    /// Update the kind of an existing window entry.
    ///
    /// NOTE: This does NOT enforce one-folder-one-window. Use
    /// `try_claim_folder` for folder claims. This is only safe for
    /// downgrading to `FileOnly` (e.g. `unregister_window_folder`).
    pub(crate) fn update_kind(&self, label: &str, kind: WindowKind) {
        let mut entries = self.entries.lock().expect("registry lock poisoned");
        if let Some(entry) = entries.iter_mut().find(|e| e.label == label) {
            entry.kind = kind;
        }
    }

    /// Get the `WindowKind` for a registered window, if any.
    ///
    /// Returns `None` if the label is not in the registry. Returns
    /// `Some(WindowKind::FileOnly)` for orphan-file windows and
    /// `Some(WindowKind::Folder(path))` for folder-claimed windows.
    pub fn get_kind(&self, label: &str) -> Option<WindowKind> {
        let entries = self.entries.lock().expect("registry lock poisoned");
        entries
            .iter()
            .find(|e| e.label == label)
            .map(|e| e.kind.clone())
    }

    /// Atomically claim a folder for a window, enforcing one-folder-one-window.
    ///
    /// - If the folder is already owned by `label` → update in place, return `Ok`.
    /// - If the folder is owned by a different window → return `Err(existing_label)`.
    /// - If `label` is not registered → return `Err("window not registered")`.
    /// - Otherwise → update `label`'s kind to `Folder(path)`, return `Ok`.
    pub fn try_claim_folder(&self, label: &str, path: PathBuf) -> Result<(), String> {
        let mut entries = self.entries.lock().expect("registry lock poisoned");
        // Check if another window already owns this folder
        for entry in entries.iter() {
            if let WindowKind::Folder(p) = &entry.kind {
                if paths_equal(p, &path) && entry.label != label {
                    return Err(entry.label.clone());
                }
            }
        }
        // Find and update this window's kind
        if let Some(entry) = entries.iter_mut().find(|e| e.label == label) {
            entry.kind = WindowKind::Folder(path);
            Ok(())
        } else {
            Err("window not registered".to_string())
        }
    }

    /// Remove a window by label.
    pub fn unregister(&self, label: &str) {
        let mut entries = self.entries.lock().expect("registry lock poisoned");
        entries.retain(|e| e.label != label);
        // Clean up any pending args for this window
        if let Ok(mut pending) = self.pending_args.lock() {
            pending.remove(label);
        }
    }

    /// Queue launch args for a window that hasn't loaded React yet.
    pub fn push_args(&self, label: &str, args: LaunchArgs) {
        let mut pending = self.pending_args.lock().expect("pending_args lock poisoned");
        pending.entry(label.to_string()).or_default().push(args);
    }

    /// Drain all queued launch args for a window, merging batches with dedup.
    pub fn drain_args(&self, label: &str) -> LaunchArgs {
        let mut pending = self.pending_args.lock().expect("pending_args lock poisoned");
        let batches = pending.remove(label).unwrap_or_default();
        let mut files = Vec::new();
        let mut folders = Vec::new();
        for batch in batches {
            for f in batch.files {
                if !files.contains(&f) {
                    files.push(f);
                }
            }
            for d in batch.folders {
                if !folders.contains(&d) {
                    folders.push(d);
                }
            }
        }
        LaunchArgs { files, folders }
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

    /// Target-aware variant of [`route_folder`]: when the user's gesture
    /// has an unambiguous target window (drag-drop landed on a specific
    /// window), prefer claiming the new folder for the **target** if it
    /// is currently `FileOnly`. This matches the toolbar's "Open Folder"
    /// dialog behaviour for the empty-workspace case (the freshly-opened
    /// app's `main` window adopts the dropped folder as its workspace
    /// root) without disturbing windows that already own a folder
    /// (those still spawn a new window — Architecture rule:
    /// one-folder-one-window preserved).
    ///
    /// Decision table:
    /// - Folder already open in any window → `FocusExisting(label)` (same as `route_folder`).
    /// - `target_label` is `FileOnly` → `ClaimForTarget { target_label, path }` (NEW).
    /// - Otherwise → `CreateFolder { path }`.
    ///
    /// The caller (`route_args_to_window`) then atomically claims the
    /// folder for the target via `try_claim_folder` — failure (race vs.
    /// concurrent claim from another window) falls back to spawning a
    /// new window per the existing `multiwin-atomic-registry-mutations`
    /// rule.
    pub fn route_folder_for_target(
        &self,
        folder: &Path,
        target_label: &str,
    ) -> RouteDecision {
        if let Some(label) = self.find_by_folder(folder) {
            return RouteDecision::FocusExisting(label);
        }
        if let Some(WindowKind::FileOnly) = self.get_kind(target_label) {
            return RouteDecision::ClaimForTarget {
                target_label: target_label.to_string(),
                path: folder.to_path_buf(),
            };
        }
        RouteDecision::CreateFolder {
            path: folder.to_path_buf(),
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

    /// Target-aware variant of [`route_file`]: route a dropped file to
    /// the window the user dropped it onto (if scope-compatible) rather
    /// than to whatever `find_file_only` happens to return first.
    ///
    /// Decision table:
    /// - File is under `target_label`'s `Folder(...)` workspace → `AddToWindow(target)`.
    /// - File is under any OTHER open folder → `AddToWindow(that label)` (focus that workspace's window — the file's natural home outranks the drop target).
    /// - Otherwise → `AddToWindow(target_label)` (the user explicitly picked this window; route there even if it's `FileOnly` or owns an unrelated folder — `route_args_to_window`'s `AddToWindow` arm extends asset-protocol scope to cover the file).
    ///
    /// This honours the user's explicit drop target (architect H1)
    /// without breaking the existing "files under an open folder belong
    /// in that folder's window" UX.
    pub fn route_file_for_target(
        &self,
        file: &Path,
        target_label: &str,
    ) -> RouteDecision {
        if let Some(WindowKind::Folder(folder)) = self.get_kind(target_label) {
            if is_ancestor(&folder, file) {
                return RouteDecision::AddToWindow {
                    label: target_label.to_string(),
                    files: vec![file.to_path_buf()],
                };
            }
        }
        if let Some(label) = self.find_ancestor_folder(file) {
            return RouteDecision::AddToWindow {
                label,
                files: vec![file.to_path_buf()],
            };
        }
        RouteDecision::AddToWindow {
            label: target_label.to_string(),
            files: vec![file.to_path_buf()],
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

    // ── Target-aware routing (PR #372 review of architect-expert H1) ─────

    #[test]
    fn route_folder_for_target_focus_when_already_open_anywhere() {
        // Even with a `target_label`, a folder that's already open in
        // some other window must focus that window — never split-claim.
        let reg = WindowRegistry::new();
        reg.register("a".into(), WindowKind::Folder(PathBuf::from("/proj")));
        reg.register("b".into(), WindowKind::FileOnly);

        match reg.route_folder_for_target(Path::new("/proj"), "b") {
            RouteDecision::FocusExisting(label) => assert_eq!(label, "a"),
            other => panic!("expected FocusExisting(a), got {other:?}"),
        }
    }

    #[test]
    fn route_folder_for_target_claim_when_target_is_file_only() {
        // FileOnly target adopts the dropped folder — UX matches "Open
        // Folder via toolbar" replacing the empty workspace.
        let reg = WindowRegistry::new();
        reg.register("main".into(), WindowKind::FileOnly);

        match reg.route_folder_for_target(Path::new("/new-proj"), "main") {
            RouteDecision::ClaimForTarget { target_label, path } => {
                assert_eq!(target_label, "main");
                assert_eq!(path, PathBuf::from("/new-proj"));
            }
            other => panic!("expected ClaimForTarget(main), got {other:?}"),
        }
    }

    #[test]
    fn route_folder_for_target_creates_when_target_already_owns_folder() {
        // Target window already has a workspace — preserve it; the new
        // folder gets a new window. Avoids surprise replacement of the
        // user's current work.
        let reg = WindowRegistry::new();
        reg.register("a".into(), WindowKind::Folder(PathBuf::from("/proj-a")));

        match reg.route_folder_for_target(Path::new("/proj-b"), "a") {
            RouteDecision::CreateFolder { path } => {
                assert_eq!(path, PathBuf::from("/proj-b"));
            }
            other => panic!("expected CreateFolder, got {other:?}"),
        }
    }

    #[test]
    fn route_folder_for_target_creates_when_target_unknown() {
        // Defensive: a stale target label (window destroyed mid-drop)
        // falls through to CreateFolder so no panic / silent loss.
        let reg = WindowRegistry::new();

        match reg.route_folder_for_target(Path::new("/new"), "ghost") {
            RouteDecision::CreateFolder { path } => assert_eq!(path, PathBuf::from("/new")),
            other => panic!("expected CreateFolder, got {other:?}"),
        }
    }

    #[test]
    fn route_file_for_target_routes_to_target_when_in_its_folder() {
        // File under the target's workspace → straight to target.
        let reg = WindowRegistry::new();
        reg.register("a".into(), WindowKind::Folder(PathBuf::from("/proj")));

        match reg.route_file_for_target(Path::new("/proj/src/main.rs"), "a") {
            RouteDecision::AddToWindow { label, files } => {
                assert_eq!(label, "a");
                assert_eq!(files, vec![PathBuf::from("/proj/src/main.rs")]);
            }
            other => panic!("expected AddToWindow(a), got {other:?}"),
        }
    }

    #[test]
    fn route_file_for_target_prefers_natural_home_over_target() {
        // File belongs under window A's folder, but user dropped on B.
        // The file's natural home outranks — it goes to A (and A
        // focuses). UX reflects "files belong with their workspace".
        let reg = WindowRegistry::new();
        reg.register("a".into(), WindowKind::Folder(PathBuf::from("/proj-a")));
        reg.register("b".into(), WindowKind::Folder(PathBuf::from("/proj-b")));

        match reg.route_file_for_target(Path::new("/proj-a/foo.md"), "b") {
            RouteDecision::AddToWindow { label, files } => {
                assert_eq!(label, "a");
                assert_eq!(files, vec![PathBuf::from("/proj-a/foo.md")]);
            }
            other => panic!("expected AddToWindow(a), got {other:?}"),
        }
    }

    #[test]
    fn route_file_for_target_orphan_routes_to_target_not_first_file_only() {
        // Architect H1 repro: with two FileOnly windows, a drop on B
        // MUST land in B — not A just because A appears first in
        // `find_file_only`. This is the bug the target-aware path fixes.
        let reg = WindowRegistry::new();
        reg.register("a".into(), WindowKind::FileOnly);
        reg.register("b".into(), WindowKind::FileOnly);

        match reg.route_file_for_target(Path::new("/random/foo.md"), "b") {
            RouteDecision::AddToWindow { label, files } => {
                assert_eq!(label, "b", "drop on B must route to B, not A");
                assert_eq!(files, vec![PathBuf::from("/random/foo.md")]);
            }
            other => panic!("expected AddToWindow(b), got {other:?}"),
        }
    }

    #[test]
    fn route_file_for_target_target_with_unrelated_folder_still_takes_orphan() {
        // Target owns folder /proj-a; user drops /random/foo.md (not
        // under any open folder) onto target. Route to target — the
        // user's gesture wins; `route_args_to_window` will extend
        // asset-protocol scope to cover the orphan's parent dir.
        let reg = WindowRegistry::new();
        reg.register("a".into(), WindowKind::Folder(PathBuf::from("/proj-a")));

        match reg.route_file_for_target(Path::new("/random/foo.md"), "a") {
            RouteDecision::AddToWindow { label, files } => {
                assert_eq!(label, "a");
                assert_eq!(files, vec![PathBuf::from("/random/foo.md")]);
            }
            other => panic!("expected AddToWindow(a), got {other:?}"),
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

    // ── Per-window pending args tests ─────────────────────────────────────

    #[test]
    fn push_and_drain_args_single_batch() {
        let reg = WindowRegistry::new();
        reg.push_args(
            "w1",
            LaunchArgs {
                files: vec!["/a.md".into()],
                folders: vec!["/proj".into()],
            },
        );
        let result = reg.drain_args("w1");
        assert_eq!(result.files, vec!["/a.md".to_string()]);
        assert_eq!(result.folders, vec!["/proj".to_string()]);
    }

    #[test]
    fn drain_args_merges_and_dedupes_multiple_batches() {
        let reg = WindowRegistry::new();
        reg.push_args(
            "w1",
            LaunchArgs {
                files: vec!["/a.md".into(), "/b.md".into()],
                folders: vec!["/x".into()],
            },
        );
        reg.push_args(
            "w1",
            LaunchArgs {
                files: vec!["/b.md".into(), "/c.md".into()],
                folders: vec!["/x".into(), "/y".into()],
            },
        );
        let result = reg.drain_args("w1");
        assert_eq!(
            result.files,
            vec!["/a.md".to_string(), "/b.md".to_string(), "/c.md".to_string()]
        );
        assert_eq!(result.folders, vec!["/x".to_string(), "/y".to_string()]);
    }

    #[test]
    fn drain_args_returns_empty_when_nothing_queued() {
        let reg = WindowRegistry::new();
        let result = reg.drain_args("nonexistent");
        assert!(result.files.is_empty());
        assert!(result.folders.is_empty());
    }

    #[test]
    fn drain_args_clears_queue() {
        let reg = WindowRegistry::new();
        reg.push_args(
            "w1",
            LaunchArgs {
                files: vec!["/a.md".into()],
                folders: vec![],
            },
        );
        let first = reg.drain_args("w1");
        assert_eq!(first.files.len(), 1);

        let second = reg.drain_args("w1");
        assert!(second.files.is_empty());
    }

    #[test]
    fn unregister_cleans_up_pending_args() {
        let reg = WindowRegistry::new();
        reg.register("w1".into(), WindowKind::FileOnly);
        reg.push_args(
            "w1",
            LaunchArgs {
                files: vec!["/a.md".into()],
                folders: vec![],
            },
        );
        reg.unregister("w1");
        let result = reg.drain_args("w1");
        assert!(result.files.is_empty());
    }

    #[test]
    fn push_args_isolates_windows() {
        let reg = WindowRegistry::new();
        reg.push_args(
            "w1",
            LaunchArgs {
                files: vec!["/a.md".into()],
                folders: vec![],
            },
        );
        reg.push_args(
            "w2",
            LaunchArgs {
                files: vec!["/b.md".into()],
                folders: vec![],
            },
        );
        let r1 = reg.drain_args("w1");
        let r2 = reg.drain_args("w2");
        assert_eq!(r1.files, vec!["/a.md".to_string()]);
        assert_eq!(r2.files, vec!["/b.md".to_string()]);
    }

    // ── try_claim_folder tests (issue #248) ────────────────────────────────

    #[test]
    fn try_claim_folder_succeeds_when_unclaimed() {
        let reg = WindowRegistry::new();
        reg.register("w1".into(), WindowKind::FileOnly);
        assert!(reg.try_claim_folder("w1", PathBuf::from("/projects/a")).is_ok());
        assert_eq!(reg.find_by_folder(Path::new("/projects/a")), Some("w1".into()));
    }

    #[test]
    fn try_claim_folder_allows_same_window_reclaim() {
        let reg = WindowRegistry::new();
        reg.register("w1".into(), WindowKind::Folder(PathBuf::from("/projects/a")));
        // Same window re-claiming same folder should succeed
        assert!(reg.try_claim_folder("w1", PathBuf::from("/projects/a")).is_ok());
    }

    #[test]
    fn try_claim_folder_allows_same_window_switch() {
        let reg = WindowRegistry::new();
        reg.register("w1".into(), WindowKind::Folder(PathBuf::from("/projects/a")));
        // Same window switching to a different folder should succeed
        assert!(reg.try_claim_folder("w1", PathBuf::from("/projects/b")).is_ok());
        assert_eq!(reg.find_by_folder(Path::new("/projects/b")), Some("w1".into()));
        // Old folder should no longer be claimed
        assert_eq!(reg.find_by_folder(Path::new("/projects/a")), None);
    }

    #[test]
    fn try_claim_folder_rejects_duplicate() {
        let reg = WindowRegistry::new();
        reg.register("w1".into(), WindowKind::Folder(PathBuf::from("/projects/a")));
        reg.register("w2".into(), WindowKind::FileOnly);
        // w2 trying to claim w1's folder should fail
        let result = reg.try_claim_folder("w2", PathBuf::from("/projects/a"));
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "w1");
        // w1 should still own the folder
        assert_eq!(reg.find_by_folder(Path::new("/projects/a")), Some("w1".into()));
    }

    #[test]
    fn try_claim_folder_case_insensitive_on_windows() {
        let reg = WindowRegistry::new();
        reg.register("w1".into(), WindowKind::Folder(PathBuf::from("C:\\Projects\\App")));
        reg.register("w2".into(), WindowKind::FileOnly);
        if cfg!(windows) {
            // Different case should still be detected as duplicate
            let result = reg.try_claim_folder("w2", PathBuf::from("c:\\projects\\app"));
            assert!(result.is_err());
        }
    }

    #[test]
    fn setup_dedup_via_route_folder() {
        // Simulates the setup() path: registering "main" then routing extras
        let reg = WindowRegistry::new();
        let folder = PathBuf::from("/projects/a");
        reg.register("main".into(), WindowKind::Folder(folder.clone()));

        // Routing the same folder should return FocusExisting, not CreateFolder
        match reg.route_folder(&folder) {
            RouteDecision::FocusExisting(label) => assert_eq!(label, "main"),
            other => panic!("expected FocusExisting, got {other:?}"),
        }
    }

    #[test]
    fn try_claim_folder_rejects_unregistered_label() {
        let reg = WindowRegistry::new();
        // Label "ghost" was never registered
        let result = reg.try_claim_folder("ghost", PathBuf::from("/projects/a"));
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "window not registered");
        // Folder should NOT be claimed
        assert_eq!(reg.find_by_folder(Path::new("/projects/a")), None);
    }
}
