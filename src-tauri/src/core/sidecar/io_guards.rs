//! Read-side chokepoints for sidecar I/O.
//!
//! Lifted out of `sidecar/mod.rs` to keep that file under the 400 LOC
//! budget (rule 23 in `docs/architecture.md`). These functions are the
//! only sanctioned way to ingest sidecar bytes from disk; both the YAML
//! and JSON load paths in [`super::load_sidecar`] / [`super::patch_comment`]
//! call [`read_capped`] (and the YAML branch additionally calls
//! [`reject_yaml_anchors`]) before any parser touches the content.
//!
//! Visibility is `pub(crate)` on purpose: no command handler outside
//! this module should be reading sidecars directly — it must go through
//! the `sidecar` API, which guarantees the cap + anchor-rejection
//! invariants documented in `docs/security.md` rule 3.

use regex::Regex;
use std::sync::OnceLock;

/// Hard cap on sidecar size (10 MB). Protects every reader
/// (`load_sidecar`, `patch_comment`, `get_file_comments`, `get_file_badges`,
/// `export_review_summary`) against OOM from a maliciously-crafted or
/// pathologically-large sidecar.
pub(crate) const SIDECAR_MAX_BYTES: u64 = 10 * 1024 * 1024;

/// Read a sidecar file, refusing anything larger than [`SIDECAR_MAX_BYTES`].
///
/// Mirrors the `read_text_file` chokepoint pattern in `commands/fs.rs`: the
/// size check happens on already-read bytes (single bounded read of MAX+1),
/// not on `metadata()` followed by a second read. This avoids two attack
/// classes documented in `docs/security.md` rule 3:
///   1. **Symlink amplification.** `metadata()` follows symlinks, so a
///      symlink to `/dev/zero` (or any virtual file) reports `len() == 0`
///      and would pass a metadata-based cap before `read_to_string` OOMs.
///   2. **TOCTOU.** A file can grow between `metadata()` and the read.
pub(crate) fn read_capped(path: &str) -> std::io::Result<String> {
    use std::io::Read;
    let mut f = std::fs::File::open(path)?;
    let mut buf = Vec::with_capacity(8 * 1024);
    let n = f
        .by_ref()
        .take(SIDECAR_MAX_BYTES + 1)
        .read_to_end(&mut buf)?;
    if n as u64 > SIDECAR_MAX_BYTES {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "sidecar exceeds 10 MB cap",
        ));
    }
    String::from_utf8(buf).map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))
}

/// Reject any YAML anchor (`&name`) or alias (`*name`) before parsing.
///
/// The 10 MB byte cap doesn't bound YAML alias/anchor expansion (the
/// "billion-laughs" amplification class). Our writer never emits anchors,
/// so refusing them wholesale is safe and closes the amplification surface.
///
/// Detects only positional anchors/aliases — at line start or after a YAML
/// structural token (`-`, `?`, `:`, `,`, `[`, `{`) followed by whitespace —
/// to avoid false positives on `&` / `*` inside string values.
pub(crate) fn reject_yaml_anchors(text: &str) -> std::io::Result<()> {
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| {
        // Anchor or alias in YAML node-position: line start with optional
        // indent and optional list/key marker, OR after a flow/block token.
        // Examples matched: `node: &x foo`, `- &a 1`, `[*x, *y]`, `key: *ref`.
        Regex::new(r"(?m)(?:^[ \t]*(?:[-?][ \t]+)?|[,\[\{][ \t]*|:[ \t]+)[&*][A-Za-z0-9_]+")
            .expect("valid regex")
    });
    if re.is_match(text) {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "yaml anchors/aliases not allowed in sidecars",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn reject_yaml_anchors_allows_amp_inside_text() {
        // Comment text legitimately containing `&` or `*` (e.g. `R&D`,
        // pointers in code samples) must not trigger the anchor scanner.
        let ok = "comments:\n  - id: c1\n    text: \"R&D and *important*\"\n";
        assert!(reject_yaml_anchors(ok).is_ok());
    }

    #[test]
    fn reject_yaml_anchors_flags_block_anchor() {
        let bad = "node: &x foo\nother: *x\n";
        assert!(reject_yaml_anchors(bad).is_err());
    }

    /// Iter-3 carry-over: explicit assertion that the 10 MB cap actually
    /// fires on the read path (previously only enforced indirectly via
    /// `load_sidecar` integration paths). Builds an oversized file under
    /// a `TempDir` so the test cannot leak data between runs.
    #[test]
    fn read_capped_rejects_over_cap() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("oversized.review.yaml");
        std::fs::write(&path, vec![b'a'; (SIDECAR_MAX_BYTES + 1) as usize]).unwrap();

        let err = read_capped(path.to_str().unwrap()).unwrap_err();
        assert_eq!(err.kind(), std::io::ErrorKind::InvalidData);
        assert!(
            err.to_string().contains("10 MB cap"),
            "expected '10 MB cap' marker in error, got: {err}"
        );
    }

    /// Off-by-one companion to [`read_capped_rejects_over_cap`]: a file
    /// at exactly the cap must be accepted (the cap is inclusive of MAX,
    /// exclusive of MAX+1).
    #[test]
    fn read_capped_accepts_at_cap() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("at_cap.review.yaml");
        std::fs::write(&path, vec![b'a'; SIDECAR_MAX_BYTES as usize]).unwrap();

        let content = read_capped(path.to_str().unwrap()).expect("at-cap read must succeed");
        assert_eq!(content.len() as u64, SIDECAR_MAX_BYTES);
    }
}
