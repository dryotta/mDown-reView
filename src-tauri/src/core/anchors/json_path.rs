use super::MatchOutcome;
use crate::core::types::JsonPathAnchor;

/// Translate a dot-notation path (e.g. `"a.b[2].c"`, optionally prefixed
/// `"$"`) to RFC 6901 JSON Pointer (`"/a/b/2/c"`). Predicates of the form
/// `[id=42]` are dropped (heuristic: locate by structural path only). Per
/// RFC 6901, `~` and `/` inside segment names are escaped to `~0` / `~1`.
///
/// D2 — keys containing `.`, `[`, or `]` are emitted by the TypeScript
/// authoring layer as JSON-string-escaped bracket segments
/// (`parent["a.b"]`). When such a segment is encountered, decode the inner
/// JSON-escaped key and append it as a single pointer segment (still
/// applying RFC-6901 `~`/`/` escaping).
fn dot_to_pointer(path: &str) -> String {
    let mut out = String::new();
    let trimmed = path.strip_prefix('$').unwrap_or(path);
    let bytes = trimmed.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        let c = bytes[i] as char;
        if c == '.' {
            i += 1;
            continue;
        }
        if c == '[' {
            // Bracket segment. May be:
            //   ["..."]   → quoted key (D2 escape syntax)
            //   [42]      → numeric index
            //   [k=v]     → predicate (dropped)
            let end = match find_matching_bracket(bytes, i) {
                Some(e) => e,
                None => break,
            };
            let inner = &trimmed[i + 1..end];
            if let Some(decoded) = decode_quoted_key(inner) {
                push_segment(&mut out, &decoded);
            } else if !inner.contains('=') {
                push_segment(&mut out, inner);
            }
            i = end + 1;
            continue;
        }
        // Identifier segment: read up to next `.` or `[`.
        let start = i;
        while i < bytes.len() {
            let ch = bytes[i] as char;
            if ch == '.' || ch == '[' {
                break;
            }
            i += 1;
        }
        if start < i {
            let name = &trimmed[start..i];
            push_segment(&mut out, name);
        }
    }
    out
}

/// Find the index of the `]` that closes the `[` at `start`, respecting
/// JSON-string quoting so `["a]b"]` is treated as one segment.
fn find_matching_bracket(bytes: &[u8], start: usize) -> Option<usize> {
    debug_assert!(bytes.get(start).copied() == Some(b'['));
    let mut i = start + 1;
    let mut in_string = false;
    let mut escaped = false;
    while i < bytes.len() {
        let c = bytes[i] as char;
        if in_string {
            if escaped {
                escaped = false;
            } else if c == '\\' {
                escaped = true;
            } else if c == '"' {
                in_string = false;
            }
        } else if c == '"' {
            in_string = true;
        } else if c == ']' {
            return Some(i);
        }
        i += 1;
    }
    None
}

/// If `inner` is a JSON-string-escaped key (starts with `"`, ends with
/// `"`), parse it via `serde_json` and return the decoded string.
fn decode_quoted_key(inner: &str) -> Option<String> {
    let trimmed = inner.trim();
    if !(trimmed.starts_with('"') && trimmed.ends_with('"') && trimmed.len() >= 2) {
        return None;
    }
    serde_json::from_str::<String>(trimmed).ok()
}

/// Append a single decoded segment to `out`, applying RFC-6901 escaping.
fn push_segment(out: &mut String, segment: &str) {
    out.push('/');
    for ch in segment.chars() {
        match ch {
            '~' => out.push_str("~0"),
            '/' => out.push_str("~1"),
            c => out.push(c),
        }
    }
}

/// Resolve a [`JsonPathAnchor`] against a parsed `serde_json::Value`. If
/// `scalar_text` is recorded, compare it against the located value's stringy
/// form for `Exact` vs `Fuzzy` differentiation.
pub(crate) fn resolve(p: &JsonPathAnchor, doc: Option<&serde_json::Value>) -> MatchOutcome {
    let doc = match doc {
        Some(d) => d,
        None => return MatchOutcome::Orphan,
    };
    let pointer = dot_to_pointer(&p.json_path);
    match doc.pointer(&pointer) {
        None => MatchOutcome::Orphan,
        Some(val) => match &p.scalar_text {
            None => MatchOutcome::Exact,
            Some(expected) => {
                let actual = val
                    .as_str()
                    .map(|s| s.to_string())
                    .unwrap_or_else(|| val.to_string());
                if actual == *expected {
                    MatchOutcome::Exact
                } else {
                    MatchOutcome::Fuzzy
                }
            }
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn doc() -> serde_json::Value {
        json!({
            "user": { "name": "Alice", "age": 30 },
            "items": [{"id": 1}, {"id": 2}, {"id": 3}]
        })
    }

    fn anchor(path: &str, scalar: Option<&str>) -> JsonPathAnchor {
        JsonPathAnchor {
            json_path: path.into(),
            scalar_text: scalar.map(str::to_string),
        }
    }

    #[test]
    fn path_exists_scalar_matches_exact() {
        let d = doc();
        assert_eq!(
            resolve(&anchor("$.user.name", Some("Alice")), Some(&d)),
            MatchOutcome::Exact
        );
    }

    #[test]
    fn path_exists_scalar_differs_fuzzy() {
        let d = doc();
        assert_eq!(
            resolve(&anchor("$.user.name", Some("Bob")), Some(&d)),
            MatchOutcome::Fuzzy
        );
    }

    #[test]
    fn path_missing_orphan() {
        let d = doc();
        assert_eq!(
            resolve(&anchor("$.user.email", None), Some(&d)),
            MatchOutcome::Orphan
        );
    }

    #[test]
    fn nested_path_exact() {
        let d = doc();
        assert_eq!(
            resolve(&anchor("$.items[1].id", Some("2")), Some(&d)),
            MatchOutcome::Exact
        );
    }

    // D2 — keys containing `.`, `[`, or `]` round-trip through the
    // `parent["a.b"]` JSON-string escape syntax.
    #[test]
    fn quoted_key_with_dot_resolves() {
        let d = serde_json::json!({ "a.b": 1, "x[y]": 2 });
        assert_eq!(dot_to_pointer("[\"a.b\"]"), "/a.b");
        assert_eq!(
            resolve(&anchor("[\"a.b\"]", Some("1")), Some(&d)),
            MatchOutcome::Exact
        );
        assert_eq!(
            resolve(&anchor("[\"x[y]\"]", Some("2")), Some(&d)),
            MatchOutcome::Exact
        );
    }

    #[test]
    fn quoted_key_nested_after_parent() {
        let d = serde_json::json!({ "outer": { "in.ner": "v" } });
        assert_eq!(dot_to_pointer("outer[\"in.ner\"]"), "/outer/in.ner");
        assert_eq!(
            resolve(&anchor("outer[\"in.ner\"]", Some("v")), Some(&d)),
            MatchOutcome::Exact
        );
    }

    #[test]
    fn quoted_key_with_slash_applies_rfc6901_escape() {
        // The decoded key contains `/`, which must be re-escaped to `~1`
        // in the JSON Pointer.
        assert_eq!(dot_to_pointer("[\"a/b\"]"), "/a~1b");
    }
}
