//! Workspace-write IPC chokepoint.
//!
//! Architecture rule 32 (`docs/architecture.md`): every IPC that mutates a
//! user-workspace file flows through this module. Security rule 29
//! (`docs/security.md`): five bounds before any byte hits disk:
//!   1. Filename has no `:` (NTFS Alternate Data Stream defence).
//!   2. Parent dir canonicalizes inside an active workspace folder.
//!   3. Destination extension (lowercased post-canonical-parent) is in the
//!      workspace-write allowlist.
//!   4. Payload size ≤ 10 MB.
//!   5. Write goes through `core::atomic::write_atomic`.
//!
//! Bounds 1-3 are enforced by `ensure_writable`; bound 4 is enforced
//! per-command (text length / decoded base64 length); bound 5 is the final
//! call. A failure at any bound returns a typed `String` error and writes
//! nothing.

use crate::core::atomic::write_atomic;
use crate::core::paths::canonicalize_no_verbatim;
use crate::mdr_command;
use crate::watcher::WatcherState;
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use serde::Serialize;
use specta::Type;
use std::path::{Path, PathBuf};

/// Issue #352 / iter-12 (architect HIGH#3 + security MEDIUM#3) — typed
/// workspace-write error.
///
/// The previous `Result<(), String>` return surface forced the renderer
/// to substring-match the Rust prose in `friendlySaveError` — a wire
/// contract maintained by string sniffing that silently breaks if the
/// Rust message format ever changes (rule `architecture-rust-first` in
/// `docs/architecture.md`). The typed enum is round-tripped via
/// tauri-specta so the renderer branches on `err.kind` directly. See
/// `src/lib/excalidraw/error-mapping.ts` for the consumer.
///
/// Discriminator is `kind`, kebab-case on the wire — same shape as
/// `CommentError` (see `commands/comments/error.rs`).
#[derive(Debug, Clone, Serialize, Type)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum WorkspaceWriteError {
    /// Canonical path is outside any open workspace folder, OR target
    /// is an existing symlink whose target escapes the workspace.
    OutsideWorkspace { path: String },
    /// Lowercased filename suffix is not in `WORKSPACE_WRITE_ALLOWLIST`.
    /// Carries the offending filename so a renderer can hint at the
    /// correct extension family.
    ExtNotAllowed { filename: String },
    /// Filename contains a forbidden character (currently only `:`,
    /// the NTFS Alternate Data Stream marker).
    FilenameInvalid { reason: String },
    /// Decoded payload exceeds `WORKSPACE_WRITE_MAX_BYTES`. Surfaces
    /// the observed byte count so the renderer can compute an MB
    /// figure for user-facing copy.
    PayloadTooLarge { observed_bytes: u64 },
    /// Base64 string was structurally invalid (only emitted by the
    /// binary IPC).
    InvalidBase64 { detail: String },
    /// I/O failure during canonicalisation, atomic-rename, or any
    /// underlying syscall. Fallback variant carrying the original error
    /// text so a renderer can surface a developer-debuggable string.
    Io { message: String },
}

impl std::fmt::Display for WorkspaceWriteError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::OutsideWorkspace { path } => {
                write!(f, "path is outside an open workspace: {path}")
            }
            Self::ExtNotAllowed { filename } => {
                write!(f, "extension not in workspace-write allowlist: {filename}")
            }
            Self::FilenameInvalid { reason } => write!(f, "invalid filename: {reason}"),
            Self::PayloadTooLarge { observed_bytes } => {
                write!(
                    f,
                    "payload exceeds {WORKSPACE_WRITE_MAX_BYTES}-byte cap: {observed_bytes} bytes"
                )
            }
            Self::InvalidBase64 { detail } => write!(f, "invalid base64 payload: {detail}"),
            Self::Io { message } => write!(f, "io error: {message}"),
        }
    }
}

impl WorkspaceWriteError {
    fn io(msg: impl Into<String>) -> Self {
        Self::Io { message: msg.into() }
    }
}

/// Maximum payload size for workspace-write IPC. Symmetric with the read cap
/// (security rule 1) and matches the public-facing 10 MB ceiling documented
/// in security rule 29.
pub(crate) const WORKSPACE_WRITE_MAX_BYTES: usize = 10 * 1024 * 1024;

/// Issue #352 / iter-12 (security HIGH#1) — TTL for self-write suppression
/// registered before `write_atomic`. Symmetric with `SAVE_DEBOUNCE_MS` in
/// `useFileWatcher.ts` (1500 ms): long enough that the rename event reaches
/// the notify-debouncer-mini stream before the entry expires; short enough
/// that a real subsequent external write fired ~1.6 s after our own save
/// is not silently absorbed.
const SELF_WRITE_SUPPRESSION_TTL: std::time::Duration =
    std::time::Duration::from_millis(1500);

/// Lowercase extension allowlist for the Excalidraw family. Matched as
/// **suffix** against the lowercased filename — `Path::extension()` would
/// only see `png` for `foo.excalidraw.png`, missing the compound suffix.
const WORKSPACE_WRITE_ALLOWLIST: &[&str] = &[
    ".excalidraw",
    ".excalidrawlib",
    ".excalidraw.png",
    ".excalidraw.svg",
];

/// Verify the (potentially-not-yet-existing) target path is safe to write.
///
/// Returns the canonical destination path on success, or a typed
/// `WorkspaceWriteError` discriminator on failure.
fn ensure_writable(
    path_str: &str,
    state: &WatcherState,
) -> Result<PathBuf, WorkspaceWriteError> {
    let target = Path::new(path_str);

    // (1) Reject `:` in the user-supplied filename component BEFORE any
    // canonicalisation. NTFS Alternate Data Streams smuggle bytes into a
    // hidden stream of an allowlisted file (e.g. `foo.excalidraw:hidden.exe`).
    let file_name = target
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| WorkspaceWriteError::FilenameInvalid {
            reason: "no UTF-8 component".to_string(),
        })?;
    if file_name.contains(':') {
        return Err(WorkspaceWriteError::FilenameInvalid {
            reason: "':' is forbidden (NTFS ADS)".to_string(),
        });
    }

    // (2) Workspace-allowlist check using the parent-relaxed variant — the
    // target file may not exist yet, but the parent must canonicalise inside
    // a watched workspace folder.
    if !state.is_path_or_parent_allowed(target) {
        return Err(WorkspaceWriteError::OutsideWorkspace {
            path: path_str.to_string(),
        });
    }

    // (3) Resolve canonical parent + original filename.
    let parent = target
        .parent()
        .ok_or_else(|| WorkspaceWriteError::Io {
            message: "path has no parent".to_string(),
        })?;
    let canonical_parent = canonicalize_no_verbatim(parent).map_err(|e| {
        WorkspaceWriteError::Io {
            message: format!("parent dir does not canonicalise: {e}"),
        }
    })?;
    let canonical = canonical_parent.join(file_name);

    let lowered_name = file_name.to_ascii_lowercase();
    let allowlisted = WORKSPACE_WRITE_ALLOWLIST
        .iter()
        .any(|suffix| lowered_name.ends_with(suffix));
    if !allowlisted {
        return Err(WorkspaceWriteError::ExtNotAllowed {
            filename: file_name.to_string(),
        });
    }

    // Symlink target canonicalisation (security MEDIUM#2).
    if target.exists() {
        let target_canonical = canonicalize_no_verbatim(target).map_err(|e| {
            WorkspaceWriteError::Io {
                message: format!("target canonicalisation failed: {e}"),
            }
        })?;
        if !state.is_path_or_parent_allowed(&target_canonical) {
            return Err(WorkspaceWriteError::OutsideWorkspace {
                path: target_canonical.to_string_lossy().into_owned(),
            });
        }
    }

    Ok(canonical)
}

/// Write a UTF-8 text payload to a workspace file (Excalidraw scene JSON or
/// `.excalidrawlib`). Bounds: parent inside workspace, extension in
/// allowlist, no `:` in filename, byte length ≤ `WORKSPACE_WRITE_MAX_BYTES`,
/// atomic write.
#[mdr_command]
pub fn write_workspace_text(
    path: String,
    text: String,
    state: tauri::State<'_, WatcherState>,
) -> Result<(), WorkspaceWriteError> {
    write_workspace_text_inner(state.inner(), &path, &text)
}

/// Inner implementation of [`write_workspace_text`], without the
/// `tauri::State` wrapper. Tests call this directly because `tauri::State`
/// can only be constructed by the runtime — same split pattern as
/// `commands::fs::read_text_file_inner`.
pub(crate) fn write_workspace_text_inner(
    state: &WatcherState,
    path: &str,
    text: &str,
) -> Result<(), WorkspaceWriteError> {
    let bytes = text.as_bytes();
    if bytes.len() > WORKSPACE_WRITE_MAX_BYTES {
        return Err(WorkspaceWriteError::PayloadTooLarge {
            observed_bytes: bytes.len() as u64,
        });
    }
    let canonical = ensure_writable(path, state)?;
    // Issue #352 / iter-14 (security MEDIUM, bug-expert LOW-MEDIUM):
    // register the self-write suppression entry ONLY after the atomic
    // commit succeeds. Pre-iter-14 we registered before `write_atomic`,
    // which meant a failed write left a 1500 ms suppression entry that
    // silently absorbed legitimate external mutations on the same path.
    // The narrow remaining race (watcher fires the rename event before
    // the entry lands, ~µs scale) is bounded by the
    // notify-debouncer-mini 300 ms debounce + the rename-then-emit
    // ordering — the entry lands well within that window.
    write_atomic(&canonical, bytes).map_err(|e| {
        tracing::error!("[rust] write_workspace_text error: {e}");
        WorkspaceWriteError::io(e.to_string())
    })?;
    state.register_self_write(canonical, SELF_WRITE_SUPPRESSION_TTL);
    Ok(())
}

/// Write a binary payload (base64-encoded on the wire) to a workspace file
/// (`.excalidraw.png` / `.excalidraw.svg` re-rendered with embedded scene).
#[mdr_command]
pub fn write_workspace_binary(
    path: String,
    base64: String,
    state: tauri::State<'_, WatcherState>,
) -> Result<(), WorkspaceWriteError> {
    write_workspace_binary_inner(state.inner(), &path, &base64)
}

/// Inner implementation of [`write_workspace_binary`].
pub(crate) fn write_workspace_binary_inner(
    state: &WatcherState,
    path: &str,
    base64: &str,
) -> Result<(), WorkspaceWriteError> {
    // Pre-decode size guard so a multi-GB string can't OOM the decoder.
    let max_b64_len = WORKSPACE_WRITE_MAX_BYTES.saturating_mul(4) / 3 + 4;
    if base64.len() > max_b64_len {
        return Err(WorkspaceWriteError::PayloadTooLarge {
            observed_bytes: base64.len() as u64,
        });
    }
    let bytes = B64
        .decode(base64)
        .map_err(|e| WorkspaceWriteError::InvalidBase64 { detail: e.to_string() })?;
    if bytes.len() > WORKSPACE_WRITE_MAX_BYTES {
        return Err(WorkspaceWriteError::PayloadTooLarge {
            observed_bytes: bytes.len() as u64,
        });
    }
    let canonical = ensure_writable(path, state)?;
    // Iter-14 — register suppression AFTER atomic-commit success.
    // See `write_workspace_text_inner` for rationale.
    write_atomic(&canonical, &bytes).map_err(|e| {
        tracing::error!("[rust] write_workspace_binary error: {e}");
        WorkspaceWriteError::io(e.to_string())
    })?;
    state.register_self_write(canonical, SELF_WRITE_SUPPRESSION_TTL);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::watcher::WatcherState;
    use tempfile::TempDir;

    /// Mirrors `commands::comments::badges::tests::watcher_state_allowing` —
    /// the canonical helper for building a `WatcherState` whose workspace
    /// scope is exactly `dir`. We pass `dir` as both the root and the only
    /// dir because `set_tree_watched_dirs` requires every entry to
    /// `starts_with(canonical_root)`.
    fn watcher_with_workspace(dir: &Path) -> WatcherState {
        let canonical = canonicalize_no_verbatim(dir).expect("canonicalize test dir");
        let (tx, _rx) = std::sync::mpsc::sync_channel(1);
        let state = WatcherState::new(tx);
        state
            .set_tree_watched_dirs(
                "test",
                canonical.to_string_lossy().into_owned(),
                vec![canonical.to_string_lossy().into_owned()],
            )
            .unwrap();
        state
    }

    #[test]
    fn rejects_path_outside_workspace() {
        let tmp = TempDir::new().unwrap();
        let state = watcher_with_workspace(tmp.path());
        let outside = std::env::temp_dir().join("not-in-workspace.excalidraw");
        let err = write_workspace_text_inner(&state, &outside.to_string_lossy(), "{}").unwrap_err();
        assert!(
            matches!(err, WorkspaceWriteError::OutsideWorkspace { .. }),
            "expected OutsideWorkspace, got: {err:?}"
        );
    }

    #[test]
    fn rejects_disallowed_extension_txt() {
        let tmp = TempDir::new().unwrap();
        let state = watcher_with_workspace(tmp.path());
        let target = tmp.path().join("hello.txt");
        let err =
            write_workspace_text_inner(&state, &target.to_string_lossy(), "hello").unwrap_err();
        assert!(
            matches!(err, WorkspaceWriteError::ExtNotAllowed { .. }),
            "expected ExtNotAllowed, got: {err:?}"
        );
    }

    #[test]
    fn rejects_plain_png() {
        let tmp = TempDir::new().unwrap();
        let state = watcher_with_workspace(tmp.path());
        let target = tmp.path().join("plain.png");
        let err = write_workspace_binary_inner(
            &state,
            &target.to_string_lossy(),
            &B64.encode(b"PNG\n"),
        )
        .unwrap_err();
        assert!(
            matches!(err, WorkspaceWriteError::ExtNotAllowed { .. }),
            "expected ExtNotAllowed, got: {err:?}"
        );
    }

    #[test]
    fn accepts_case_folded_compound_suffix() {
        // Foo.Excalidraw.PNG is allowlisted because we lowercase before the
        // suffix check. Verifies the AC1 family is robust to NTFS case
        // folding.
        let tmp = TempDir::new().unwrap();
        let state = watcher_with_workspace(tmp.path());
        let target = tmp.path().join("Foo.Excalidraw.PNG");
        let res = write_workspace_binary_inner(
            &state,
            &target.to_string_lossy(),
            &B64.encode(b"PNG\n"),
        );
        assert!(res.is_ok(), "expected accept, got: {:?}", res);
        assert_eq!(std::fs::read(&target).unwrap(), b"PNG\n");
    }

    #[test]
    fn rejects_excalidraw_dot_exe_smuggled() {
        let tmp = TempDir::new().unwrap();
        let state = watcher_with_workspace(tmp.path());
        let target = tmp.path().join("Foo.excalidraw.exe");
        let err =
            write_workspace_text_inner(&state, &target.to_string_lossy(), "{}").unwrap_err();
        assert!(
            matches!(err, WorkspaceWriteError::ExtNotAllowed { .. }),
            "expected ExtNotAllowed, got: {err:?}"
        );
    }

    #[test]
    fn rejects_colon_in_filename_ntfs_ads() {
        // The colon defence runs BEFORE canonicalization, so even on Linux
        // where the colon wouldn't smuggle anything, the IPC hard-rejects.
        let tmp = TempDir::new().unwrap();
        let state = watcher_with_workspace(tmp.path());
        let smuggled = format!(
            "{}{}foo.excalidraw:hidden.exe",
            tmp.path().to_string_lossy(),
            std::path::MAIN_SEPARATOR
        );
        let err = write_workspace_text_inner(&state, &smuggled, "{}").unwrap_err();
        match err {
            WorkspaceWriteError::FilenameInvalid { ref reason } => {
                assert!(reason.contains("NTFS ADS"), "got: {reason}");
            }
            other => panic!("expected FilenameInvalid, got: {other:?}"),
        }
    }

    #[test]
    fn allows_target_that_does_not_yet_exist() {
        let tmp = TempDir::new().unwrap();
        let state = watcher_with_workspace(tmp.path());
        let target = tmp.path().join("brand-new.excalidraw");
        assert!(!target.exists());
        let res = write_workspace_text_inner(&state, &target.to_string_lossy(), r#"{"v":1}"#);
        assert!(res.is_ok(), "got: {:?}", res);
        assert_eq!(std::fs::read_to_string(&target).unwrap(), r#"{"v":1}"#);
    }

    #[test]
    fn rejects_oversize_text_payload() {
        let tmp = TempDir::new().unwrap();
        let state = watcher_with_workspace(tmp.path());
        let target = tmp.path().join("big.excalidraw");
        let huge = "x".repeat(WORKSPACE_WRITE_MAX_BYTES + 1);
        let err = write_workspace_text_inner(&state, &target.to_string_lossy(), &huge).unwrap_err();
        assert!(
            matches!(err, WorkspaceWriteError::PayloadTooLarge { .. }),
            "expected PayloadTooLarge, got: {err:?}"
        );
        assert!(
            !target.exists(),
            "no file should be written on size-failure"
        );
    }

    #[test]
    fn rejects_oversize_base64_payload_pre_decode() {
        let tmp = TempDir::new().unwrap();
        let state = watcher_with_workspace(tmp.path());
        let target = tmp.path().join("big.excalidraw.png");
        let max_b64 = WORKSPACE_WRITE_MAX_BYTES.saturating_mul(4) / 3 + 4;
        let huge = "A".repeat(max_b64 + 1);
        let err =
            write_workspace_binary_inner(&state, &target.to_string_lossy(), &huge).unwrap_err();
        assert!(
            matches!(err, WorkspaceWriteError::PayloadTooLarge { .. }),
            "expected PayloadTooLarge, got: {err:?}"
        );
        assert!(
            !target.exists(),
            "no file should be written on size-failure"
        );
    }

    #[test]
    fn rejects_invalid_base64() {
        let tmp = TempDir::new().unwrap();
        let state = watcher_with_workspace(tmp.path());
        let target = tmp.path().join("foo.excalidraw.svg");
        let err = write_workspace_binary_inner(
            &state,
            &target.to_string_lossy(),
            "not-base64!!!",
        )
        .unwrap_err();
        assert!(
            matches!(err, WorkspaceWriteError::InvalidBase64 { .. }),
            "expected InvalidBase64, got: {err:?}"
        );
        assert!(!target.exists());
    }

    #[test]
    fn text_write_round_trips() {
        let tmp = TempDir::new().unwrap();
        let state = watcher_with_workspace(tmp.path());
        let target = tmp.path().join("scene.excalidraw");
        let payload = r#"{"type":"excalidraw","elements":[]}"#;
        write_workspace_text_inner(&state, &target.to_string_lossy(), payload).unwrap();
        assert_eq!(std::fs::read_to_string(&target).unwrap(), payload);
    }

    #[test]
    fn binary_write_round_trips() {
        let tmp = TempDir::new().unwrap();
        let state = watcher_with_workspace(tmp.path());
        let target = tmp.path().join("scene.excalidraw.png");
        let raw = b"\x89PNG\r\n\x1a\n<embedded scene>";
        write_workspace_binary_inner(&state, &target.to_string_lossy(), &B64.encode(raw)).unwrap();
        assert_eq!(std::fs::read(&target).unwrap(), raw);
    }

    #[test]
    fn accepts_text_payload_at_exact_10mb_boundary() {
        // The cap guard is `>` not `>=`, so exactly WORKSPACE_WRITE_MAX_BYTES
        // must round-trip. Locks in the off-by-one boundary for the
        // size-cap arithmetic introduced in iter 1 of issue #352.
        let tmp = TempDir::new().unwrap();
        let state = watcher_with_workspace(tmp.path());
        let target = tmp.path().join("boundary.excalidraw");
        let exactly_max = "x".repeat(WORKSPACE_WRITE_MAX_BYTES);
        write_workspace_text_inner(&state, &target.to_string_lossy(), &exactly_max).unwrap();
        assert_eq!(
            std::fs::metadata(&target).unwrap().len() as usize,
            WORKSPACE_WRITE_MAX_BYTES
        );
    }

    /// Issue #352 / iter-12 (security HIGH#1) — every successful write
    /// MUST register a self-write suppression entry against the
    /// canonical destination path, so the watcher event handler can
    /// skip the echo without depending on the renderer's
    /// post-IPC `recordSave` race.
    #[test]
    fn text_write_registers_self_write_suppression() {
        let tmp = TempDir::new().unwrap();
        let state = watcher_with_workspace(tmp.path());
        let target = tmp.path().join("scene.excalidraw");
        write_workspace_text_inner(&state, &target.to_string_lossy(), r#"{"v":1}"#).unwrap();
        let canonical = canonicalize_no_verbatim(&target).unwrap();
        assert!(
            state.is_self_write_suppressed(&canonical),
            "expected self-write suppression entry for {}",
            canonical.display()
        );
    }

    #[test]
    fn binary_write_registers_self_write_suppression() {
        let tmp = TempDir::new().unwrap();
        let state = watcher_with_workspace(tmp.path());
        let target = tmp.path().join("scene.excalidraw.png");
        write_workspace_binary_inner(
            &state,
            &target.to_string_lossy(),
            &B64.encode(b"PNG\n"),
        )
        .unwrap();
        let canonical = canonicalize_no_verbatim(&target).unwrap();
        assert!(
            state.is_self_write_suppressed(&canonical),
            "expected self-write suppression entry for {}",
            canonical.display()
        );
    }

    /// Issue #352 / iter-14 (bug-expert LOW-MEDIUM, security MEDIUM):
    /// a failed `write_atomic` MUST NOT leak a self-write suppression
    /// entry. Pre-iter-14 the entry was registered before the atomic
    /// commit; on failure it persisted for the full 1500 ms TTL,
    /// silently absorbing legitimate external mutations of the same
    /// path. Locks the iter-14 invariant: register-only-on-success.
    ///
    /// Provoking failure deterministically: pre-create the target as
    /// a directory. `write_atomic`'s rename(temp_file, target_dir)
    /// fails on every supported OS (Windows + Unix both reject
    /// rename-file-onto-non-empty-dir).
    #[test]
    fn text_write_failure_does_not_register_self_write_suppression() {
        let tmp = TempDir::new().unwrap();
        let state = watcher_with_workspace(tmp.path());
        let target = tmp.path().join("scene.excalidraw");
        std::fs::create_dir(&target).unwrap();
        // Drop a sentinel file inside so cross-OS the rename fails
        // cleanly (some filesystems allow rename-onto-empty-dir).
        std::fs::write(target.join("sentinel"), "x").unwrap();

        let res = write_workspace_text_inner(
            &state,
            &target.to_string_lossy(),
            r#"{"v":1}"#,
        );
        assert!(res.is_err(), "rename onto a directory should fail");

        let canonical = canonicalize_no_verbatim(&target).unwrap();
        assert!(
            !state.is_self_write_suppressed(&canonical),
            "failed write must not leak a suppression entry; got entry for {}",
            canonical.display()
        );
    }

    #[test]
    fn binary_write_failure_does_not_register_self_write_suppression() {
        let tmp = TempDir::new().unwrap();
        let state = watcher_with_workspace(tmp.path());
        let target = tmp.path().join("scene.excalidraw.png");
        std::fs::create_dir(&target).unwrap();
        std::fs::write(target.join("sentinel"), "x").unwrap();

        let res = write_workspace_binary_inner(
            &state,
            &target.to_string_lossy(),
            &B64.encode(b"PNG\n"),
        );
        assert!(res.is_err(), "rename onto a directory should fail");

        let canonical = canonicalize_no_verbatim(&target).unwrap();
        assert!(
            !state.is_self_write_suppressed(&canonical),
            "failed binary write must not leak a suppression entry"
        );
    }

    /// Issue #352 / iter-12 (security MEDIUM#2) — when the target
    /// already exists, full-target canonicalisation must reject paths
    /// whose canonical form escapes the workspace. Symlink case is
    /// Unix-only (TempDir on Windows can't create symlinks without
    /// developer-mode); guarded accordingly.
    #[cfg(unix)]
    #[test]
    fn rejects_target_that_is_symlink_pointing_outside_workspace() {
        use std::os::unix::fs::symlink;

        let outside = TempDir::new().unwrap();
        let target_outside = outside.path().join("real.excalidraw");
        std::fs::write(&target_outside, "{}").unwrap();

        let tmp = TempDir::new().unwrap();
        let state = watcher_with_workspace(tmp.path());
        let symlink_path = tmp.path().join("evil.excalidraw");
        symlink(&target_outside, &symlink_path).unwrap();
        assert!(symlink_path.exists(), "symlink should report exists");

        let err = write_workspace_text_inner(
            &state,
            &symlink_path.to_string_lossy(),
            r#"{"v":1}"#,
        )
        .unwrap_err();
        assert!(
            matches!(err, WorkspaceWriteError::OutsideWorkspace { .. }),
            "expected OutsideWorkspace, got: {err:?}"
        );
        // The on-disk content of the symlink target must NOT have
        // changed — the validation rejected the write before any IO.
        assert_eq!(std::fs::read_to_string(&target_outside).unwrap(), "{}");
    }
}
