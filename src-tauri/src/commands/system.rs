//! System integration commands: reveal in OS file manager, open in default app.
//!
//! Both commands enforce a workspace allowlist via
//! [`crate::watcher::WatcherState::is_path_allowed`] so a malicious renderer
//! cannot ask the OS to open arbitrary paths (e.g. `~/.ssh/id_rsa`). The path
//! must either be currently open in a tab or inside an open workspace folder.
//!
//! Spawning is done with `std::process::Command::new(...).spawn()` so the OS
//! handles its own ACLs / quarantine / file-association lookup. We never read
//! the spawned process's stdout/stderr — once the child is launched we detach.

use std::path::Path;
use std::process::Command;

/// Typed error surfaced to the renderer. Discriminated with an internal `kind`
/// tag so the TS side can branch on it without parsing prose strings.
#[derive(serde::Serialize, Debug)]
#[serde(tag = "kind")]
pub enum SystemError {
    /// Caller asked us to act on a path outside the open workspace and not in
    /// any open tab. This is the only path-validation outcome the renderer
    /// can recover from (e.g. by surfacing an "open the folder first" prompt).
    PathOutsideWorkspace,
    /// The OS-level spawn failed (binary missing, permission denied, etc.).
    IoError { message: String },
    /// The current platform has no implementation (e.g. Linux `xdg-open`
    /// missing in a barebones container).
    Unsupported,
}

impl SystemError {
    fn io(e: std::io::Error) -> Self {
        SystemError::IoError {
            message: e.to_string(),
        }
    }
}

/// Build the OS-specific reveal-in-folder command without spawning. Split out
/// so unit tests can verify shape on every platform without touching the FS
/// or the user's window manager.
pub(crate) fn build_reveal_command(path: &Path) -> Result<Command, SystemError> {
    if cfg!(target_os = "windows") {
        // /select, must NOT have a space after the comma — `explorer` parses
        // it as a single token with the path appended.
        let mut cmd = Command::new("explorer");
        cmd.arg(format!("/select,{}", path.display()));
        Ok(cmd)
    } else if cfg!(target_os = "macos") {
        let mut cmd = Command::new("open");
        cmd.arg("-R").arg(path);
        Ok(cmd)
    } else if cfg!(target_os = "linux") {
        // No portable "select" equivalent on Linux; open the parent dir.
        let parent = path.parent().unwrap_or(path);
        let mut cmd = Command::new("xdg-open");
        cmd.arg(parent);
        Ok(cmd)
    } else {
        Err(SystemError::Unsupported)
    }
}

/// Build the OS-specific open-in-default-app command without spawning.
///
/// **Windows is intentionally absent** — see [`open_in_default_app`]. We used
/// to spawn `cmd /c start "" <path>` here, but `cmd.exe` re-parses
/// metacharacters (`&`, `^`, `%VAR%`) inside quoted args, breaking the
/// workspace allowlist guarantee. Windows now goes through
/// `tauri-plugin-opener::open_path` (ShellExecuteW under the hood), which
/// opens the path verbatim with no shell expansion.
pub(crate) fn build_open_command(path: &Path) -> Result<Command, SystemError> {
    if cfg!(target_os = "macos") {
        let mut cmd = Command::new("open");
        cmd.arg(path);
        Ok(cmd)
    } else if cfg!(target_os = "linux") {
        let mut cmd = Command::new("xdg-open");
        cmd.arg(path);
        Ok(cmd)
    } else {
        // Windows + anything else: callers must dispatch via plugin-opener.
        Err(SystemError::Unsupported)
    }
}

/// Open the OS file manager and select the file at `path`.
///
/// Workspace-allowlisted via `WatcherState::is_path_allowed`. On Linux there
/// is no portable "select" — we open the parent directory instead.
#[tauri::command]
pub fn reveal_in_folder(
    path: String,
    state: tauri::State<'_, crate::watcher::WatcherState>,
) -> Result<(), SystemError> {
    let p = Path::new(&path);
    if !state.is_path_allowed(p) {
        tracing::warn!("[system] reveal_in_folder rejected: path outside workspace");
        return Err(SystemError::PathOutsideWorkspace);
    }
    let mut cmd = build_reveal_command(p)?;
    cmd.spawn().map_err(SystemError::io)?;
    Ok(())
}

/// Open the file at `path` with the OS-registered default application.
///
/// Workspace-allowlisted. On macOS / Linux uses native `open` / `xdg-open`.
/// On Windows we route through `tauri-plugin-opener::open_path` (which calls
/// `ShellExecuteW` directly) instead of spawning `cmd /c start` — the latter
/// re-parses `&`, `^`, and `%VAR%` inside quoted args, which would let a
/// malicious path bypass the allowlist guarantee even after the
/// `is_path_allowed` check.
#[tauri::command]
pub fn open_in_default_app(
    path: String,
    state: tauri::State<'_, crate::watcher::WatcherState>,
) -> Result<(), SystemError> {
    let p = Path::new(&path);
    if !state.is_path_allowed(p) {
        tracing::warn!("[system] open_in_default_app rejected: path outside workspace");
        return Err(SystemError::PathOutsideWorkspace);
    }
    #[cfg(target_os = "windows")]
    {
        // `tauri_plugin_opener::open_path` calls ShellExecuteW with the path
        // as a verbatim argument — no shell expansion, no re-parsing.
        tauri_plugin_opener::open_path(p, None::<&str>)
            .map_err(|e| SystemError::IoError { message: e.to_string() })?;
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let mut cmd = build_open_command(p)?;
        cmd.spawn().map_err(SystemError::io)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cmd_program(c: &Command) -> String {
        c.get_program().to_string_lossy().into_owned()
    }

    #[test]
    fn build_reveal_command_uses_platform_binary() {
        // Use a path that exists on every platform so .display() is stable.
        let tmp = tempfile::NamedTempFile::new().unwrap();
        let cmd = build_reveal_command(tmp.path()).expect("supported platform");

        let prog = cmd_program(&cmd);
        if cfg!(target_os = "windows") {
            assert_eq!(prog, "explorer");
            let args: Vec<String> = cmd
                .get_args()
                .map(|a| a.to_string_lossy().into_owned())
                .collect();
            assert_eq!(args.len(), 1, "expected exactly one /select, arg");
            assert!(
                args[0].starts_with("/select,"),
                "missing /select, prefix: {}",
                args[0]
            );
        } else if cfg!(target_os = "macos") {
            assert_eq!(prog, "open");
        } else if cfg!(target_os = "linux") {
            assert_eq!(prog, "xdg-open");
        }
    }

    #[test]
    fn build_open_command_uses_platform_binary() {
        let tmp = tempfile::NamedTempFile::new().unwrap();
        // Windows is routed via tauri-plugin-opener (see open_in_default_app)
        // and therefore returns Unsupported here — there is intentionally no
        // `Command` shape to assert.
        if cfg!(target_os = "windows") {
            let res = build_open_command(tmp.path());
            assert!(matches!(res, Err(SystemError::Unsupported)));
            return;
        }
        let cmd = build_open_command(tmp.path()).expect("supported platform");
        let prog = cmd_program(&cmd);
        if cfg!(target_os = "macos") {
            assert_eq!(prog, "open");
        } else if cfg!(target_os = "linux") {
            assert_eq!(prog, "xdg-open");
        }
    }

    /// Workspace allowlist: a path inside a registered tree-watched dir is
    /// accepted; a path outside it is rejected with `PathOutsideWorkspace`.
    #[test]
    fn workspace_allowlist_accepts_inside_rejects_outside() {
        let workspace = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let workspace_canonical = std::fs::canonicalize(workspace.path()).unwrap();

        let inside_file = workspace_canonical.join("inside.bin");
        std::fs::write(&inside_file, b"data").unwrap();

        let outside_file = outside.path().join("outside.bin");
        std::fs::write(&outside_file, b"data").unwrap();

        let (tx, _rx) = std::sync::mpsc::sync_channel(1);
        let state = crate::watcher::WatcherState::new(tx);
        state
            .set_tree_watched_dirs(
                workspace_canonical.to_string_lossy().into_owned(),
                vec![workspace_canonical.to_string_lossy().into_owned()],
            )
            .unwrap();

        assert!(state.is_path_allowed(&inside_file));
        assert!(!state.is_path_allowed(&outside_file));
    }

    /// `..` traversal cannot escape an allowlisted workspace because we
    /// canonicalize before comparing.
    #[test]
    fn workspace_allowlist_blocks_dot_dot_traversal() {
        let workspace = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let workspace_canonical = std::fs::canonicalize(workspace.path()).unwrap();
        let outside_canonical = std::fs::canonicalize(outside.path()).unwrap();

        let outside_file = outside_canonical.join("secret.bin");
        std::fs::write(&outside_file, b"secret").unwrap();

        let (tx, _rx) = std::sync::mpsc::sync_channel(1);
        let state = crate::watcher::WatcherState::new(tx);
        state
            .set_tree_watched_dirs(
                workspace_canonical.to_string_lossy().into_owned(),
                vec![workspace_canonical.to_string_lossy().into_owned()],
            )
            .unwrap();

        // Build a non-canonical traversal path: <workspace>/../<outside>/secret.bin.
        // Canonicalize must collapse it back to outside_canonical and reject.
        let traversal = workspace_canonical
            .join("..")
            .join(outside_canonical.file_name().unwrap())
            .join("secret.bin");
        assert!(!state.is_path_allowed(&traversal));
    }
}
