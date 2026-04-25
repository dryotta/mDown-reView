use super::MatchOutcome;
use crate::core::types::JsonPathAnchor;

/// Translate a dot-notation path (e.g. `"a.b[2].c"`, optionally prefixed
/// `"$"`) to RFC 6901 JSON Pointer (`"/a/b/2/c"`). Predicates of the form
/// `[id=42]` are dropped (heuristic: locate by structural path only). Per
/// RFC 6901, `~` and `/` inside segment names are escaped to `~0` / `~1`.
fn dot_to_pointer(path: &str) -> String {
    let mut out = String::new();
    let trimmed = path.strip_prefix('$').unwrap_or(path);
    let trimmed = trimmed.strip_prefix('.').unwrap_or(trimmed);
    for raw_seg in trimmed.split('.') {
        if raw_seg.is_empty() {
            continue;
        }
        // Split into name + zero or more bracket parts: "b[2]" → ["b","2"].
        let mut parts: Vec<String> = Vec::new();
        if let Some(bi) = raw_seg.find('[') {
            let (name, brackets) = raw_seg.split_at(bi);
            if !name.is_empty() {
                parts.push(name.to_string());
            }
            let mut rest = brackets;
            while let Some(start) = rest.find('[') {
                let after = &rest[start + 1..];
                if let Some(end) = after.find(']') {
                    let inner = &after[..end];
                    if !inner.contains('=') {
                        parts.push(inner.to_string());
                    }
                    rest = &after[end + 1..];
                } else {
                    break;
                }
            }
        } else {
            parts.push(raw_seg.to_string());
        }
        for p in parts {
            out.push('/');
            for ch in p.chars() {
                match ch {
                    '~' => out.push_str("~0"),
                    '/' => out.push_str("~1"),
                    c => out.push(c),
                }
            }
        }
    }
    out
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
}
