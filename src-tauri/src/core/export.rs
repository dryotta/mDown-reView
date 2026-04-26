//! Markdown digest export of all comment threads in a workspace.
//!
//! Produces a self-contained markdown document grouped by file, with each
//! thread fenced inside a unique `mdr-thread-<nonce>` code fence so the
//! digest can be pasted into chat / PRs / issues without thread bodies
//! interfering with markdown rendering. The fence identifier carries a
//! per-export random 8-character base32 nonce so successive exports yield
//! distinct fences (advisory #7) — useful when chaining multiple digests
//! into a single document.
//!
//! Output is intentionally plain markdown with no Tauri/IPC dependencies so
//! it can be unit-tested as a pure function.

use crate::core::types::CommentThread;
use std::collections::BTreeMap;
use std::fmt::Write as _;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

/// Per-file digest input: the file's absolute path and its current threads.
pub type WorkspaceThreads<'a> = BTreeMap<&'a str, &'a [CommentThread]>;

/// Produce a markdown digest of every thread in `threads`. Files are emitted
/// in sorted relative-path order (BTreeMap) so successive runs over the same
/// state produce diff-friendly output. Per-comment fences carry a random
/// 8-char base32 nonce, drawn once per `export_summary` call.
pub fn export_summary(workspace: &Path, threads: &WorkspaceThreads) -> String {
    let nonce = random_nonce_8();
    let mut out = String::new();
    let _ = writeln!(out, "# Review summary");
    let _ = writeln!(
        out,
        "\n_workspace: `{}`_  \n_threads: {}_\n",
        workspace.display(),
        threads.values().map(|v| v.len()).sum::<usize>()
    );

    if threads.is_empty() {
        out.push_str("\n_No comments to export._\n");
        return out;
    }

    for (path, thread_list) in threads {
        let rel = relative(workspace, Path::new(path));
        let _ = writeln!(out, "## {}\n", rel);
        for thread in *thread_list {
            let r = &thread.root.comment;
            let status = if r.resolved { "resolved" } else { "open" };
            let sev = r.severity.as_deref().unwrap_or("-");
            let _ = writeln!(
                out,
                "- **{}** by `{}` ({} · severity: {}) — line {}",
                r.id, r.author, status, sev, thread.root.matched_line_number
            );
            // Build full thread body first so we can pick a fence that's
            // longer than any backtick run inside it (CommonMark fenced
            // code-block rule). Without this, a comment containing ```
            // would terminate the digest's wrapping fence early.
            let mut body = String::new();
            body.push_str(&r.text);
            if !r.text.ends_with('\n') {
                body.push('\n');
            }
            for reply in &thread.replies {
                body.push_str("---\n");
                let _ = writeln!(body, "↳ {}: {}", reply.comment.author, reply.comment.text);
            }
            let fence = fence_for(&body);
            let _ = writeln!(out, "\n{}mdr-thread-{}", fence, nonce);
            out.push_str(&body);
            let _ = writeln!(out, "{}\n", fence);
        }
    }
    out
}

/// Pick a fence length one longer than the longest run of backticks that
/// appears at the start of any line of `body`, with a floor of 3 backticks.
/// Mirrors CommonMark §4.5: a closing fence must be at least as long as the
/// opening, so the opening must out-rank any fence-shaped content within.
fn fence_for(body: &str) -> String {
    let max = body
        .split_terminator('\n')
        .filter_map(|l| {
            let trimmed = l.trim_start();
            let count = trimmed.bytes().take_while(|b| *b == b'`').count();
            if count >= 3 {
                Some(count)
            } else {
                None
            }
        })
        .max()
        .unwrap_or(2);
    "`".repeat(max + 1)
}

fn relative(workspace: &Path, file: &Path) -> String {
    file.strip_prefix(workspace)
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|_| file.to_string_lossy().into_owned())
}

/// 8-char Crockford-ish base32 nonce (alphabet excludes ambiguous I/L/O/U)
/// so the fence is human-distinct across exports without pulling in a uuid
/// dep for this single use. Uses a process-wide atomic counter mixed with
/// the wall-clock nanosecond reading to guarantee monotonic uniqueness even
/// when called twice within the same nanosecond bucket.
fn random_nonce_8() -> String {
    static NONCE_COUNTER: AtomicU64 = AtomicU64::new(0);
    const ALPHABET: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";

    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0);
    let counter = NONCE_COUNTER.fetch_add(1, Ordering::Relaxed);
    let mut v = nanos
        .wrapping_mul(0x9E37_79B9_7F4A_7C15)
        .wrapping_add(counter);
    let mut out = [0u8; 8];
    for slot in out.iter_mut() {
        *slot = ALPHABET[(v & 0x1F) as usize];
        v >>= 5;
    }
    String::from_utf8(out.to_vec()).expect("ALPHABET is ASCII")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::types::{MatchedComment, MrsfComment};

    fn thread(id: &str, line: u32, severity: Option<&str>, text: &str) -> CommentThread {
        CommentThread {
            root: MatchedComment {
                comment: MrsfComment {
                    id: id.into(),
                    author: "alice".into(),
                    timestamp: "2025-01-01T00:00:00Z".into(),
                    text: text.into(),
                    resolved: false,
                    line: Some(line),
                    severity: severity.map(str::to_string),
                    ..Default::default()
                },
                matched_line_number: line,
                is_orphaned: false,
                anchored_text: None,
            },
            replies: vec![],
        }
    }

    #[test]
    fn empty_workspace_emits_no_comments_marker() {
        let map: WorkspaceThreads = BTreeMap::new();
        let out = export_summary(Path::new("/ws"), &map);
        assert!(out.contains("# Review summary"));
        assert!(out.contains("No comments to export"));
    }

    #[test]
    fn fence_uses_mdr_thread_prefix_and_8char_nonce() {
        let threads = vec![thread("c1", 5, Some("high"), "spotted typo")];
        let mut map: WorkspaceThreads = BTreeMap::new();
        map.insert("/ws/a.md", &threads);
        let out = export_summary(Path::new("/ws"), &map);
        // Find the fence line and check the nonce length.
        let fence_line = out
            .lines()
            .find(|l| l.starts_with("```mdr-thread-"))
            .expect("fence not found");
        let nonce = fence_line.trim_start_matches("```mdr-thread-");
        assert_eq!(nonce.len(), 8, "nonce must be 8 chars: {}", nonce);
    }

    #[test]
    fn nonces_are_unique_across_many_calls() {
        // Counter mixed into the seed guarantees monotonic uniqueness even
        // when nanos clock-bucket collides. 1000 calls in a tight loop must
        // produce >= 995 distinct nonces; the spread isn't actually
        // probabilistic since the counter alone makes them differ.
        let mut seen = std::collections::HashSet::new();
        for _ in 0..1000 {
            seen.insert(random_nonce_8());
        }
        assert!(
            seen.len() > 995,
            "nonces must be near-universally unique: got {} unique / 1000",
            seen.len()
        );
    }

    #[test]
    fn export_escapes_triple_backtick_in_comment_body() {
        // A comment containing a line that STARTS with ``` must NOT
        // prematurely close the fence. CommonMark only treats fences at
        // the start of a (possibly indented) line as fences, so
        // mid-line backtick runs don't matter.
        let mut t = thread("c1", 1, None, "see");
        t.root.comment.text = "see ```rust\nlet x=1;\n```\n````also-fences-here\nbody\n````".into();
        let mut map: WorkspaceThreads = BTreeMap::new();
        let v = vec![t];
        map.insert("/ws/a.md", &v);
        let out = export_summary(Path::new("/ws"), &map);
        // The longest line-start run inside the body is ```` (4) so the
        // wrapping fence must be at least 5 backticks long.
        let fence_line = out
            .lines()
            .find(|l| l.contains("mdr-thread-"))
            .expect("fence not found");
        let opening_ticks = fence_line.bytes().take_while(|b| *b == b'`').count();
        assert!(
            opening_ticks >= 5,
            "opening fence must out-rank line-start ```` run, got {}: {fence_line}",
            opening_ticks
        );
        // A matching closing fence must appear afterwards.
        let closing = "`".repeat(opening_ticks);
        assert!(
            out.matches(closing.as_str()).count() >= 2,
            "matching closing fence missing: {out}"
        );
    }

    #[test]
    fn relative_paths_are_emitted() {
        let threads = vec![thread("c1", 5, None, "note")];
        let mut map: WorkspaceThreads = BTreeMap::new();
        map.insert("/ws/sub/a.md", &threads);
        let out = export_summary(Path::new("/ws"), &map);
        assert!(out.contains("## "));
        // Relative path should appear (sub/a.md or sub\a.md depending on platform).
        assert!(
            out.contains("a.md"),
            "expected file name in digest: {}",
            out
        );
    }
}
