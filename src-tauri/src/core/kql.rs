//! Pure KQL pipeline parser. Splits a KQL query on top-level `|` separators
//! while respecting string literals (`"..."`, `'...'`, with backslash
//! escapes) and `//` line comments.

use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KqlPipelineStep {
    pub step: u32,
    pub operator: String,
    pub details: String,
    pub is_source: bool,
}

/// Tokenize KQL input into pipeline segments. String literals and line
/// comments are respected so that `|` inside a string does not split.
fn tokenize(input: &str) -> Vec<String> {
    let chars: Vec<char> = input.chars().collect();
    let mut tokens: Vec<String> = Vec::new();
    let mut current = String::new();
    let mut in_string: Option<char> = None;
    let mut escaped = false;
    let mut i = 0usize;

    while i < chars.len() {
        let ch = chars[i];

        if escaped {
            current.push(ch);
            escaped = false;
            i += 1;
            continue;
        }

        if let Some(quote) = in_string {
            current.push(ch);
            if ch == '\\' {
                escaped = true;
            } else if ch == quote {
                in_string = None;
            }
            i += 1;
            continue;
        }

        // Line comment: skip to end of line (newline itself is consumed too,
        // mirroring the TS implementation which advances `i` until `\n` and
        // then the outer loop's `i++` skips the newline).
        if ch == '/' && i + 1 < chars.len() && chars[i + 1] == '/' {
            while i < chars.len() && chars[i] != '\n' {
                i += 1;
            }
            continue;
        }

        if ch == '"' || ch == '\'' {
            in_string = Some(ch);
            current.push(ch);
            i += 1;
            continue;
        }

        if ch == '|' {
            let trimmed = current.trim().to_string();
            if !trimmed.is_empty() {
                tokens.push(trimmed);
            }
            current.clear();
            i += 1;
            continue;
        }

        current.push(ch);
        i += 1;
    }

    let trimmed = current.trim().to_string();
    if !trimmed.is_empty() {
        tokens.push(trimmed);
    }

    tokens
}

/// Parse a KQL query into a sequence of pipeline steps. The first segment is
/// treated as the source table (or source expression).
pub fn parse_kql_pipeline(input: &str) -> Vec<KqlPipelineStep> {
    if input.trim().is_empty() {
        return Vec::new();
    }
    let segments = tokenize(input);
    let mut steps = Vec::with_capacity(segments.len());
    for (index, segment) in segments.into_iter().enumerate() {
        let trimmed = segment.trim().to_string();
        if index == 0 {
            steps.push(KqlPipelineStep {
                step: 1,
                operator: trimmed,
                details: String::new(),
                is_source: true,
            });
        } else {
            let mut parts = trimmed.split_whitespace();
            let operator = parts.next().unwrap_or("").to_string();
            let details = parts.collect::<Vec<&str>>().join(" ");
            steps.push(KqlPipelineStep {
                step: (index + 1) as u32,
                operator,
                details,
                is_source: false,
            });
        }
    }
    steps
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_simple_pipeline() {
        let r = parse_kql_pipeline("StormEvents | where State == 'FL' | count");
        assert_eq!(r.len(), 3);
        assert_eq!(r[0].operator, "StormEvents");
        assert!(r[0].is_source);
        assert_eq!(r[1].operator, "where");
        assert_eq!(r[1].details, "State == 'FL'");
        assert_eq!(r[2].operator, "count");
    }

    #[test]
    fn handles_multi_line_input() {
        let r = parse_kql_pipeline("Logs\n| where Level == 'Error'\n| summarize count() by Source");
        assert_eq!(r.len(), 3);
        assert_eq!(r[1].operator, "where");
        assert_eq!(r[2].operator, "summarize");
    }

    #[test]
    fn handles_empty_input() {
        assert!(parse_kql_pipeline("").is_empty());
        assert!(parse_kql_pipeline("   \n\t").is_empty());
    }

    #[test]
    fn ignores_pipes_inside_string_literals() {
        let r = parse_kql_pipeline("T | where Name == \"a|b\" | count");
        assert_eq!(r.len(), 3);
        assert_eq!(r[1].operator, "where");
        assert!(r[1].details.contains("a|b"));
    }

    #[test]
    fn ignores_line_comments() {
        // `// rest` is dropped, so the second segment is just `count`.
        let r = parse_kql_pipeline("T | count // trailing comment\n| where x > 1");
        assert!(r.iter().any(|s| s.operator == "count"));
        assert!(r.iter().any(|s| s.operator == "where"));
    }

    #[test]
    fn handles_escaped_quote_in_string() {
        let r = parse_kql_pipeline("T | where Name == \"a\\\"b|c\" | count");
        assert_eq!(r.len(), 3);
        assert!(r[1].details.contains("a\\\"b|c"));
    }
}
