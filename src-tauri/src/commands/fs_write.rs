//! Workspace-write IPC chokepoint.
//!
//! Architecture rule 31 (`docs/architecture.md`): every IPC that mutates a
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
use std::path::{Path, PathBuf};

/// Maximum payload size for workspace-write IPC. Symmetric with the read cap
/// (security rule 1) and matches the public-facing 10 MB ceiling documented
/// in security rule 29.
pub(crate) const WORKSPACE_WRITE_MAX_BYTES: usize = 10 * 1024 * 1024;

/// Lowercase extension allowlist for the Excalidraw family. Matched as
/// **suffix** against the lowercased filename — `Path::extension()` would
/// only see `png` for `foo.excalidraw.png`, missing the compound suffix.
const WORKSPACE_WRITE_ALLOWLIST: &[&str] = &[
    ".excalidraw",
    ".excalidrawlib",
    ".excalidraw.png",
    ".excalidraw.svg",
];

/// Verify the (potentially-not-yet-existing) target path is safe to write:
///
/// 1. user-supplied filename has no `:` (Windows NTFS ADS defence — applies
///    BEFORE canonicalization because the byte string is what we're guarding).
/// 2. parent directory canonicalizes inside the active workspace
///    (`is_path_or_parent_allowed` — same semantics used by every comment-
///    mutation command per `commands/comments/mod.rs:57-62`).
/// 3. `<canonical_parent>/<original_filename>` has a lowercased filename
///    suffix in the allowlist.
///
/// Returns the canonical destination path on success.
fn ensure_writable(path_str: &str, state: &WatcherState) -> Result<PathBuf, String> {
    let target = Path::new(path_str);

    // (1) Reject `:` in the user-supplied filename component BEFORE any
    // canonicalisation. NTFS Alternate Data Streams smuggle bytes into a
    // hidden stream of an allowlisted file (e.g. `foo.excalidraw:hidden.exe`).
    let file_name = target
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| "invalid filename (no UTF-8 component)".to_string())?;
    if file_name.contains(':') {
        return Err("invalid filename: ':' is forbidden (NTFS ADS)".to_string());
    }

    // (2) Workspace-allowlist check using the parent-relaxed variant — the
    // target file may not exist yet, but the parent must canonicalise inside
    // a watched workspace folder.
    if !state.is_path_or_parent_allowed(target) {
        return Err(format!("path is outside an open workspace: {path_str}"));
    }

    // (3) Resolve canonical parent + original filename. We use the canonical
    // parent (existence-required) joined with the original filename so the
    // returned PathBuf carries no `\\?\` verbatim prefix (matches sidecar
    // saves) and the filename suffix check operates on a stable lowercased
    // form. Windows `CreateFileW` strips trailing dots/spaces, so the
    // post-canonicalisation filename is already normalised.
    let parent = target
        .parent()
        .ok_or_else(|| "path has no parent".to_string())?;
    let canonical_parent = canonicalize_no_verbatim(parent)
        .map_err(|e| format!("parent dir does not canonicalise: {e}"))?;
    let canonical = canonical_parent.join(file_name);

    let lowered_name = file_name.to_ascii_lowercase();
    let allowlisted = WORKSPACE_WRITE_ALLOWLIST
        .iter()
        .any(|suffix| lowered_name.ends_with(suffix));
    if !allowlisted {
        return Err(format!(
            "extension not in workspace-write allowlist: {file_name}"
        ));
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
) -> Result<(), String> {
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
) -> Result<(), String> {
    let bytes = text.as_bytes();
    if bytes.len() > WORKSPACE_WRITE_MAX_BYTES {
        return Err(format!(
            "payload exceeds {WORKSPACE_WRITE_MAX_BYTES}-byte cap: {} bytes",
            bytes.len()
        ));
    }
    let canonical = ensure_writable(path, state)?;
    write_atomic(&canonical, bytes).map_err(|e| {
        tracing::error!("[rust] write_workspace_text error: {e}");
        e.to_string()
    })
}

/// Write a binary payload (base64-encoded on the wire) to a workspace file
/// (`.excalidraw.png` / `.excalidraw.svg` re-rendered with embedded scene).
/// Bounds: parent inside workspace, extension in allowlist, no `:` in
/// filename, base64 string length ≤ ~14 MB, decoded bytes ≤
/// `WORKSPACE_WRITE_MAX_BYTES`, atomic write.
#[mdr_command]
pub fn write_workspace_binary(
    path: String,
    base64: String,
    state: tauri::State<'_, WatcherState>,
) -> Result<(), String> {
    write_workspace_binary_inner(state.inner(), &path, &base64)
}

/// Inner implementation of [`write_workspace_binary`]. See
/// [`write_workspace_text_inner`] for rationale.
pub(crate) fn write_workspace_binary_inner(
    state: &WatcherState,
    path: &str,
    base64: &str,
) -> Result<(), String> {
    // Pre-decode size guard so a multi-GB string can't OOM the decoder.
    // base64 is ~4/3 the size of the decoded payload; reject anything that
    // can't possibly fit under the 10 MB decoded cap.
    let max_b64_len = WORKSPACE_WRITE_MAX_BYTES.saturating_mul(4) / 3 + 4;
    if base64.len() > max_b64_len {
        return Err(format!(
            "base64 payload exceeds {max_b64_len}-byte pre-decode cap: {} chars",
            base64.len()
        ));
    }
    let bytes = B64
        .decode(base64)
        .map_err(|e| format!("invalid base64 payload: {e}"))?;
    if bytes.len() > WORKSPACE_WRITE_MAX_BYTES {
        return Err(format!(
            "decoded payload exceeds {WORKSPACE_WRITE_MAX_BYTES}-byte cap: {} bytes",
            bytes.len()
        ));
    }
    let canonical = ensure_writable(path, state)?;
    write_atomic(&canonical, &bytes).map_err(|e| {
        tracing::error!("[rust] write_workspace_binary error: {e}");
        e.to_string()
    })
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
        assert!(err.contains("outside an open workspace"), "got: {err}");
    }

    #[test]
    fn rejects_disallowed_extension_txt() {
        let tmp = TempDir::new().unwrap();
        let state = watcher_with_workspace(tmp.path());
        let target = tmp.path().join("hello.txt");
        let err =
            write_workspace_text_inner(&state, &target.to_string_lossy(), "hello").unwrap_err();
        assert!(
            err.contains("not in workspace-write allowlist"),
            "got: {err}"
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
            err.contains("not in workspace-write allowlist"),
            "got: {err}"
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
            err.contains("not in workspace-write allowlist"),
            "got: {err}"
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
        assert!(err.contains("NTFS ADS"), "got: {err}");
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
        assert!(err.contains("exceeds"), "got: {err}");
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
        assert!(err.contains("pre-decode cap"), "got: {err}");
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
        assert!(err.contains("invalid base64"), "got: {err}");
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
}
