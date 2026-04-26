//! Computes fold regions for a text buffer.
//!
//! The algorithm prefers brace-based folding (curly braces and square brackets)
//! and falls back to indentation-based folding when no brace pairs exist. For
//! known indent-only languages (Python, YAML, etc.) the indent algorithm is
//! used directly to avoid spurious brace matches inside string literals.

use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FoldRegion {
    /// 1-based line number where the foldable region starts.
    pub start_line: u32,
    /// 1-based, inclusive line number where the foldable region ends.
    pub end_line: u32,
}

/// Strip string literals and `//` line comments from a single line so that
/// brace counting does not pick up braces inside source-level strings.
fn strip_strings_and_comments(line: &str) -> String {
    let bytes: Vec<char> = line.chars().collect();
    let mut out = String::with_capacity(line.len());
    let mut in_string: Option<char> = None;
    let mut seg_start: Option<usize> = None;
    let mut i = 0usize;
    while i < bytes.len() {
        let ch = bytes[i];
        if let Some(quote) = in_string {
            if ch == '\\' && i + 1 < bytes.len() {
                i += 2;
                continue;
            }
            if ch == quote {
                in_string = None;
            }
            i += 1;
            continue;
        }
        if ch == '"' || ch == '\'' || ch == '`' {
            if let Some(start) = seg_start.take() {
                out.extend(&bytes[start..i]);
            }
            in_string = Some(ch);
            i += 1;
            continue;
        }
        if ch == '/' && i + 1 < bytes.len() && bytes[i + 1] == '/' {
            break;
        }
        if seg_start.is_none() {
            seg_start = Some(i);
        }
        i += 1;
    }
    if let Some(start) = seg_start {
        out.extend(&bytes[start..i]);
    }
    out
}

fn opener_for(ch: char) -> Option<char> {
    match ch {
        '{' => Some('}'),
        '[' => Some(']'),
        _ => None,
    }
}

fn is_closer(ch: char) -> bool {
    ch == '}' || ch == ']'
}

fn compute_brace_regions(lines: &[&str]) -> Vec<FoldRegion> {
    let mut regions = Vec::new();
    // Stack of (opening char, 1-based line number).
    let mut stack: Vec<(char, u32)> = Vec::new();

    for (i, line) in lines.iter().enumerate() {
        let stripped = strip_strings_and_comments(line);
        for ch in stripped.chars() {
            if opener_for(ch).is_some() {
                stack.push((ch, (i + 1) as u32));
            } else if is_closer(ch) {
                // Match against the nearest matching opener (mirrors TS behaviour).
                for j in (0..stack.len()).rev() {
                    if opener_for(stack[j].0) == Some(ch) {
                        let start = stack[j].1;
                        let end = (i + 1) as u32;
                        stack.remove(j);
                        if end >= start + 2 {
                            regions.push(FoldRegion {
                                start_line: start,
                                end_line: end,
                            });
                        }
                        break;
                    }
                }
            }
        }
    }

    regions
}

fn indent_width(line: &str) -> i32 {
    let mut count = 0;
    for ch in line.chars() {
        if ch == ' ' {
            count += 1;
        } else if ch == '\t' {
            count += 4;
        } else {
            break;
        }
    }
    count
}

fn compute_indent_regions(lines: &[&str]) -> Vec<FoldRegion> {
    let mut regions = Vec::new();
    // -1 means blank line (skip).
    let indents: Vec<i32> = lines
        .iter()
        .map(|l| {
            if l.trim().is_empty() {
                -1
            } else {
                indent_width(l)
            }
        })
        .collect();

    for i in 0..lines.len() {
        if indents[i] < 0 {
            continue;
        }
        let base = indents[i];
        let mut next_non_blank = i + 1;
        while next_non_blank < lines.len() && indents[next_non_blank] < 0 {
            next_non_blank += 1;
        }
        if next_non_blank >= lines.len() || indents[next_non_blank] <= base {
            continue;
        }
        let mut end = next_non_blank;
        for (j, ind) in indents.iter().enumerate().skip(next_non_blank + 1) {
            if *ind < 0 {
                continue;
            }
            if *ind <= base {
                break;
            }
            end = j;
        }
        if end > i {
            regions.push(FoldRegion {
                start_line: (i + 1) as u32,
                end_line: (end + 1) as u32,
            });
        }
    }

    regions
}

/// Returns true when the language is known to use indentation rather than
/// braces for block structure. The hint is informational only — passing an
/// unrecognised string is always safe.
fn is_indent_language(lang: &str) -> bool {
    matches!(
        lang.to_ascii_lowercase().as_str(),
        "python" | "py" | "yaml" | "yml" | "sass" | "stylus" | "pug" | "jade" | "haml" | "slim"
    )
}

/// Compute fold regions for `content`. `language` is an optional hint that
/// forces indentation-based folding for languages that do not use braces.
pub fn compute_fold_regions(content: &str, language: &str) -> Vec<FoldRegion> {
    let lines: Vec<&str> = content.split('\n').collect();
    if is_indent_language(language) {
        return compute_indent_regions(&lines);
    }
    let braces = compute_brace_regions(&lines);
    if !braces.is_empty() {
        braces
    } else {
        compute_indent_regions(&lines)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fr(start: u32, end: u32) -> FoldRegion {
        FoldRegion {
            start_line: start,
            end_line: end,
        }
    }

    fn run(lines: &[&str]) -> Vec<FoldRegion> {
        compute_fold_regions(&lines.join("\n"), "")
    }

    // ── edge cases ──────────────────────────────────────────────────────────

    #[test]
    fn empty_input_returns_empty() {
        assert_eq!(compute_fold_regions("", ""), Vec::<FoldRegion>::new());
    }

    #[test]
    fn single_line_returns_empty() {
        assert_eq!(run(&["hello world"]), Vec::<FoldRegion>::new());
    }

    #[test]
    fn single_line_with_braces_returns_empty() {
        assert_eq!(run(&["{ }"]), Vec::<FoldRegion>::new());
    }

    #[test]
    fn mixed_strings_and_code_braces() {
        let lines = [
            "const x = \"hello { world\";",
            "if (true) {",
            "  doSomething();",
            "}",
        ];
        assert_eq!(run(&lines), vec![fr(2, 4)]);
    }

    #[test]
    fn trailing_comment_after_code() {
        let lines = ["function foo() { // opens here", "  return 1;", "}"];
        assert_eq!(run(&lines), vec![fr(1, 3)]);
    }

    #[test]
    fn escaped_quotes_inside_strings() {
        let lines = [
            "const s = \"she said \\\"hi\\\"\";",
            "if (x) {",
            "  y();",
            "}",
        ];
        assert_eq!(run(&lines), vec![fr(2, 4)]);
    }

    #[test]
    fn large_input_produces_correct_results() {
        let mut lines = vec![String::from("function big() {")];
        for i in 0..1000 {
            lines.push(format!("  line{};", i));
        }
        lines.push(String::from("}"));
        let refs: Vec<&str> = lines.iter().map(String::as_str).collect();
        assert_eq!(run(&refs), vec![fr(1, 1002)]);
    }

    // ── brace matching ──────────────────────────────────────────────────────

    #[test]
    fn detects_simple_brace_block() {
        assert_eq!(
            run(&["function foo() {", "  return 1;", "}"]),
            vec![fr(1, 3)]
        );
    }

    #[test]
    fn detects_nested_brace_blocks() {
        let r = run(&["if (x) {", "  if (y) {", "    z();", "  }", "}"]);
        assert!(r.contains(&fr(1, 5)));
        assert!(r.contains(&fr(2, 4)));
    }

    #[test]
    fn ignores_braces_inside_strings() {
        assert_eq!(
            run(&["const s = \"a { b\";", "const t = 1;"]),
            Vec::<FoldRegion>::new()
        );
    }

    #[test]
    fn ignores_braces_inside_comments() {
        assert_eq!(
            run(&["// function foo() {", "const x = 1;"]),
            Vec::<FoldRegion>::new()
        );
    }

    #[test]
    fn detects_bracket_blocks() {
        assert_eq!(
            run(&["const arr = [", "  1,", "  2,", "];"]),
            vec![fr(1, 4)]
        );
    }

    #[test]
    fn requires_minimum_two_inner_lines() {
        assert_eq!(run(&["{ }", "x"]), Vec::<FoldRegion>::new());
    }

    // ── indentation ─────────────────────────────────────────────────────────

    #[test]
    fn detects_indent_block_python_like() {
        let r = run(&["def foo():", "  x = 1", "  y = 2", "z = 3"]);
        assert!(r.contains(&fr(1, 3)));
    }

    #[test]
    fn detects_nested_indent_blocks() {
        let r = run(&[
            "class Foo:",
            "  def bar():",
            "    pass",
            "  def baz():",
            "    pass",
        ]);
        assert!(r.contains(&fr(1, 5)));
        assert!(r.contains(&fr(2, 3)));
        assert!(r.contains(&fr(4, 5)));
    }

    #[test]
    fn skips_blank_lines_in_indent_tracking() {
        let r = run(&["def foo():", "  x = 1", "", "  y = 2", "z = 3"]);
        assert!(r.contains(&fr(1, 4)));
    }

    #[test]
    fn flat_file_returns_empty() {
        assert_eq!(run(&["a", "b", "c"]), Vec::<FoldRegion>::new());
    }

    // ── language hint ───────────────────────────────────────────────────────

    #[test]
    fn python_hint_forces_indent_even_when_braces_present() {
        // A stray brace pair could otherwise be interpreted; with the python
        // hint we go straight to indent regions.
        let content = "def foo():\n  x = { 1 }\n  y = 2\nbar = 3";
        let r = compute_fold_regions(content, "python");
        assert!(r.contains(&fr(1, 3)));
        // No brace-only region for the inline { 1 } (it's on a single line anyway).
    }

    #[test]
    fn yaml_hint_uses_indent() {
        let content = "root:\n  child: 1\n  other: 2\ntop: 3";
        let r = compute_fold_regions(content, "yaml");
        assert!(r.contains(&fr(1, 3)));
    }
}
