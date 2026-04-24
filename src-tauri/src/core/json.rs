//! JSONC → JSON normalisation: strips `//` and `/* */` comments and removes
//! trailing commas before `}` or `]`. Comment- and comma-like characters
//! inside string literals are preserved.

/// Strip JSONC-style comments and trailing commas, returning a string that
/// can be fed to a strict JSON parser.
pub fn strip_json_comments(text: &str) -> String {
    let chars: Vec<char> = text.chars().collect();
    let mut out = String::with_capacity(text.len());
    let mut in_string = false;
    let mut escaped = false;
    let mut i = 0usize;

    while i < chars.len() {
        let ch = chars[i];
        let next = chars.get(i + 1).copied();

        if escaped {
            out.push(ch);
            escaped = false;
            i += 1;
            continue;
        }

        if ch == '\\' && in_string {
            out.push(ch);
            escaped = true;
            i += 1;
            continue;
        }

        if ch == '"' {
            in_string = !in_string;
            out.push(ch);
            i += 1;
            continue;
        }

        if in_string {
            out.push(ch);
            i += 1;
            continue;
        }

        // Line comment
        if ch == '/' && next == Some('/') {
            i += 2;
            while i < chars.len() && chars[i] != '\n' {
                i += 1;
            }
            continue;
        }

        // Block comment
        if ch == '/' && next == Some('*') {
            i += 2;
            while i + 1 < chars.len() {
                if chars[i] == '*' && chars[i + 1] == '/' {
                    i += 2;
                    break;
                }
                i += 1;
            }
            continue;
        }

        // Trailing comma: skip a comma that is followed (after whitespace) by
        // a closing brace or bracket.
        if ch == ',' {
            let mut j = i + 1;
            while j < chars.len() && chars[j].is_whitespace() {
                j += 1;
            }
            if matches!(chars.get(j), Some('}') | Some(']')) {
                i += 1;
                continue;
            }
        }

        out.push(ch);
        i += 1;
    }

    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(s: &str) -> serde_json::Value {
        serde_json::from_str(s).expect("valid JSON")
    }

    #[test]
    fn handles_empty_input() {
        assert_eq!(strip_json_comments(""), "");
    }

    #[test]
    fn returns_valid_json_unchanged() {
        let input = "{\"key\": \"value\", \"num\": 42}";
        assert_eq!(strip_json_comments(input), input);
    }

    #[test]
    fn strips_line_comments() {
        let input = "{\n  \"key\": \"value\" // this is a comment\n}";
        let out = strip_json_comments(input);
        assert_eq!(out, "{\n  \"key\": \"value\" \n}");
        assert_eq!(parse(&out), serde_json::json!({"key": "value"}));
    }

    #[test]
    fn strips_block_comments() {
        let input = "{\n  /* comment */\n  \"key\": \"value\"\n}";
        let out = strip_json_comments(input);
        assert_eq!(out, "{\n  \n  \"key\": \"value\"\n}");
        assert_eq!(parse(&out), serde_json::json!({"key": "value"}));
    }

    #[test]
    fn strips_multi_line_block_comments() {
        let input = "{\n  /* multi\n     line\n     comment */\n  \"key\": 1\n}";
        let out = strip_json_comments(input);
        assert_eq!(parse(&out), serde_json::json!({"key": 1}));
    }

    #[test]
    fn removes_trailing_comma_before_close_brace() {
        let out = strip_json_comments("{\"a\": 1, \"b\": 2, }");
        assert_eq!(parse(&out), serde_json::json!({"a": 1, "b": 2}));
    }

    #[test]
    fn removes_trailing_comma_before_close_bracket() {
        let out = strip_json_comments("[1, 2, 3, ]");
        assert_eq!(parse(&out), serde_json::json!([1, 2, 3]));
    }

    #[test]
    fn removes_trailing_comma_with_whitespace_before_close() {
        let out = strip_json_comments("{\n  \"a\": 1,\n}");
        assert_eq!(parse(&out), serde_json::json!({"a": 1}));
    }

    #[test]
    fn preserves_double_slash_in_strings() {
        let input = "{\"url\": \"https://example.com\"}";
        assert_eq!(strip_json_comments(input), input);
    }

    #[test]
    fn preserves_block_comment_marker_in_strings() {
        let input = "{\"pattern\": \"/* glob */\"}";
        assert_eq!(strip_json_comments(input), input);
    }

    #[test]
    fn preserves_escaped_quotes_in_strings() {
        let input = "{\"escaped\": \"he said \\\"hello\\\"\"}";
        assert_eq!(strip_json_comments(input), input);
    }

    #[test]
    fn handles_combined_jsonc_features() {
        let input = "{\n  \"url\": \"https://example.com\", // a URL\n  \"note\": \"/* not a comment */\",\n  /* block comment */\n  \"trailing\": true,\n}";
        let out = strip_json_comments(input);
        assert_eq!(
            parse(&out),
            serde_json::json!({
                "url": "https://example.com",
                "note": "/* not a comment */",
                "trailing": true
            })
        );
    }
}
