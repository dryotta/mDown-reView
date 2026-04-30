//! I/O chokepoints for sidecar reads and writes.
//!
//! Lifted out of `sidecar/mod.rs` to keep that file under the 400 LOC
//! budget (rule 23 in `docs/architecture.md`). These functions are the
//! only sanctioned way to ingest sidecar bytes from disk OR to produce
//! sidecar bytes for the disk: every load path in
//! [`super::load_sidecar`] / [`super::patch_comment`] calls
//! [`read_capped`] (and the YAML branch additionally calls
//! [`reject_yaml_anchors`]) before any parser touches the content, and
//! every save path in [`super::save_sidecar_at`] / [`super::patch_comment_at`]
//! routes its YAML emission through [`emit_mrsf_yaml`] before any bytes
//! reach `write_atomic`.
//!
//! Visibility is `pub(crate)` on purpose: no command handler outside
//! this module should be reading or writing sidecars directly — it must
//! go through the `sidecar` API, which guarantees the cap + anchor
//! rejection invariants documented in `docs/security.md` rule 3 (read
//! side) and rules 4 / 8 (write side: the only acceptable failure is
//! "no write", and YAML anchors / aliases are rejected symmetrically).

use regex::Regex;
use std::sync::OnceLock;

/// Hard cap on sidecar size (10 MB). Protects every reader
/// (`load_sidecar`, `patch_comment`, `get_file_comments`, `get_file_badges`)
/// against OOM from a maliciously-crafted or pathologically-large sidecar.
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

/// Single chokepoint for emitting MRSF YAML.
///
/// Wraps `serde_saphyr::to_string`, repairs a known emitter bug in
/// `serde-saphyr-0.0.25` where block-scalar indicators in nested
/// mappings are computed as the absolute body column instead of
/// the parent-relative delta (issue #293 — YAML 1.2 §8.1.1.1
/// requires content indentation = parent_indent + N), and validates
/// by re-parsing before returning. Any non-roundtrippable output is a
/// hard `SidecarError::YamlParse`, never silent disk corruption.
///
/// Pipeline:
///   1. `serde_saphyr::to_string(value)` — initial emit.
///   2. Generic block-literal indent-repair pass on the emitted
///      text. Operates on YAML text, not field-specific values, so
///      unknown / forward-compat payloads (`Anchor::Unknown`,
///      v1.1 fields carried as `serde_json::Value`) are covered.
///   3. `reject_yaml_anchors(&repaired)` — defense-in-depth
///      symmetric write-side enforcement of the no-anchors policy
///      (`docs/security.md` rule 8). The typed structs don't emit
///      anchors today, but a future custom `Serialize` impl might.
///   4. `serde_saphyr::from_str::<serde_json::Value>(&repaired)` —
///      structural round-trip parse. Catches parse-level breakage
///      from a future repair-pass regression.
///
/// The validator rejects rather than mutates. Rule 4 in
/// `docs/security.md` ("the only acceptable failure is 'no write'")
/// applies here: the caller surfaces a save error to the user instead
/// of writing silently corrupt YAML.
pub(crate) fn emit_mrsf_yaml<T>(value: &T) -> Result<String, super::SidecarError>
where
    T: serde::Serialize,
{
    let raw = serde_saphyr::to_string(value)
        .map_err(|e| super::SidecarError::YamlParse(e.to_string()))?;
    let repaired = repair_block_scalar_indents(raw);
    validate_emitted_mrsf_yaml(&repaired)?;
    Ok(repaired)
}

/// Validation half of [`emit_mrsf_yaml`], exposed at `pub(super)` so
/// unit tests can assert the guard fires on synthetic broken output
/// without trying to provoke saphyr into emitting garbage.
pub(super) fn validate_emitted_mrsf_yaml(text: &str) -> Result<(), super::SidecarError> {
    reject_yaml_anchors(text).map_err(|e| super::SidecarError::YamlParse(e.to_string()))?;
    let _: serde_json::Value =
        serde_saphyr::from_str(text).map_err(|e| super::SidecarError::YamlParse(e.to_string()))?;
    Ok(())
}

/// Repair the saphyr-0.0.25 block-literal indent bug.
///
/// Walks the emitted YAML line-by-line. For every line ending in a
/// block-literal header `|N[+-]?` or folded header `>N[+-]?` (where
/// `N` is a single ASCII digit; bare `|` / `|-` / `|+` / `>` headers
/// have no digit and are skipped — saphyr lets the parser auto-detect
/// from body indentation in that branch, which works correctly), the
/// pass computes:
///   - `parent_col` — column of the first non-space character of the
///     header line (the dash in `- ...` or the key in `key: ...`,
///     uniformly — empirically the parser uses this column as the
///     parent indent for block scalars in both shapes).
///   - `body_col` — MINIMUM indent across every non-blank line that
///     follows and is indented strictly deeper than `parent_col`.
///     Saphyr preserves leading whitespace in the first content line
///     by emitting it at extra indent (so the leading bytes become
///     content after the strip), so only the minimum reflects the
///     body's logical indent. Blank lines are skipped (they don't
///     constrain the indicator).
/// The correct YAML 1.2 §8.1.1.1 indicator value is
/// `body_col - parent_col`. If that differs from the digit emitted
/// by saphyr, rewrite the digit (and only the digit). Body lines are
/// NOT moved — the bug is purely in the indicator, not the body
/// layout. Chomping indicators (`+` / `-`) are preserved verbatim.
///
/// Allocates only when at least one header needs repair: returns the
/// original `String` untouched otherwise (single allocation total in
/// the happy path, since `emit_mrsf_yaml` already owns `raw`).
fn repair_block_scalar_indents(yaml: String) -> String {
    static HEADER_RE: OnceLock<Regex> = OnceLock::new();
    let re = HEADER_RE.get_or_init(|| {
        // Conservative: only match lines whose prefix is a recognisable
        // YAML node-position (leading spaces, optional `- `, optional
        // `key: `). The header itself is `|` or `>`, an explicit
        // ASCII digit, optional chomp, optional trailing whitespace.
        Regex::new(
            r"^(?P<indent>[ \t]*)(?:-[ \t]+)?(?:[^\n:|>]+?:[ \t]+)?[|>](?P<digit>[0-9])[+\-]?[ \t]*$",
        )
        .expect("valid block-scalar header regex")
    });

    fn trim_eol(s: &str) -> &str {
        let s = s.strip_suffix('\n').unwrap_or(s);
        s.strip_suffix('\r').unwrap_or(s)
    }

    let lines: Vec<&str> = yaml.split_inclusive('\n').collect();
    let mut out: Option<String> = None;

    for i in 0..lines.len() {
        let line = lines[i];
        let line_no_nl = trim_eol(line);

        let caps = match re.captures(line_no_nl) {
            Some(c) => c,
            None => {
                if let Some(ref mut buf) = out {
                    buf.push_str(line);
                }
                continue;
            }
        };

        let parent_col = caps.name("indent").unwrap().as_str().len();
        let digit_match = caps.name("digit").unwrap();
        let current_n: u32 = digit_match.as_str().parse().unwrap();
        let digit_byte_offset = digit_match.start();

        // Scan body: find the MINIMUM indent across every non-blank body
        // line, stopping at any line indented `<=` parent_col (dedent).
        // Saphyr preserves leading whitespace in the first content line by
        // emitting that line at one extra indent level (the leading-space
        // bytes become content after the strip), so the FIRST body line
        // can be deeper than the body's logical indent — only the minimum
        // determines what the parser will accept (YAML 1.2 §8.1.1).
        let mut body_col: Option<usize> = None;
        for j in (i + 1)..lines.len() {
            let bl = trim_eol(lines[j]);
            if bl.is_empty() || bl.bytes().all(|b| b == b' ' || b == b'\t') {
                continue;
            }
            let lead = bl.bytes().take_while(|b| *b == b' ').count();
            if lead <= parent_col {
                break;
            }
            body_col = Some(body_col.map_or(lead, |cur| cur.min(lead)));
        }

        let needs_rewrite = body_col
            .filter(|bc| *bc > parent_col)
            .map(|bc| (bc - parent_col) as u32)
            .filter(|n| (1..=9).contains(n) && *n != current_n);

        match needs_rewrite {
            Some(expected_n) => {
                let buf = out.get_or_insert_with(|| {
                    let mut s = String::with_capacity(yaml.len());
                    for k in 0..i {
                        s.push_str(lines[k]);
                    }
                    s
                });
                buf.push_str(&line[..digit_byte_offset]);
                buf.push(char::from_digit(expected_n, 10).expect("1..=9 digit"));
                buf.push_str(&line[digit_byte_offset + 1..]);
            }
            None => {
                if let Some(ref mut buf) = out {
                    buf.push_str(line);
                }
            }
        }
    }

    out.unwrap_or(yaml)
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
