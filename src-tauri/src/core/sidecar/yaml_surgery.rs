//! Format-preserving YAML surgery for sidecar comment mutations.
//!
//! Provides string-level editing of YAML sidecar files that preserves
//! comments, key ordering, scalar styles, and whitespace. Falls back
//! gracefully (returns `None`) on any input it cannot confidently handle
//! — callers MUST keep the lossy parse→mutate→serialize path as a
//! fallback.  Kept under the 400-LOC budget (rule 23).

use crate::core::types::CommentMutation;

// ── Block finder ──────────────────────────────────────────────────────

/// Find the byte range `[start, end)` of a comment entry inside the
/// top-level `comments:` sequence, identified by its `id` field.
///
/// The range starts at the leading `- ` of the entry and extends to
/// just before the next list item at the same indent (or EOF).
fn find_comment_block(yaml: &str, comment_id: &str) -> Option<(usize, usize)> {
    // 1. Locate `comments:` key line — could be at start or after '\n'.
    let comments_key_pos = if yaml.starts_with("comments:") {
        0
    } else {
        yaml.find("\ncomments:").map(|p| p + 1)?
    };

    // Find the end of the `comments:` line.
    let after_key = yaml[comments_key_pos..].find('\n')? + comments_key_pos + 1;

    // Determine list-item indent: first `- ` after the `comments:` key.
    let first_dash_rel = yaml[after_key..].find("- ")?;
    let first_dash_abs = after_key + first_dash_rel;

    // Measure indent (spaces before the dash on its line).
    let first_line_start = yaml[..first_dash_abs].rfind('\n').map_or(0, |p| p + 1);
    let indent = first_dash_abs - first_line_start;
    let indent_str: String = " ".repeat(indent);
    let item_prefix = format!("\n{}- ", indent_str);

    // 2. Walk list items, collecting their start offsets.
    //    All offsets point to the beginning of the line (including indent).
    let mut item_starts: Vec<usize> = Vec::new();
    item_starts.push(first_line_start);

    let mut search_pos = first_dash_abs;
    while let Some(rel) = yaml[search_pos + 1..].find(&item_prefix) {
        let abs = search_pos + 1 + rel + 1; // +1 to skip the leading '\n'
        item_starts.push(abs);
        search_pos = abs;
    }

    // 3. For each item, check if it contains `id: <comment_id>`.
    for (i, &start) in item_starts.iter().enumerate() {
        let end = if i + 1 < item_starts.len() {
            item_starts[i + 1]
        } else {
            yaml.len()
        };
        let block = &yaml[start..end];
        if block_has_id(block, comment_id) {
            return Some((start, end));
        }
    }
    None
}

/// Check whether a block's `id:` field matches `comment_id`.
/// Handles unquoted, single-quoted, and double-quoted scalars.
/// Also handles `- id: value` (key on same line as list marker).
fn block_has_id(block: &str, comment_id: &str) -> bool {
    for line in block.lines() {
        let trimmed = line.trim();
        // Strip optional list marker `- ` prefix.
        let key_part = trimmed.strip_prefix("- ").unwrap_or(trimmed);
        if let Some(rest) = key_part.strip_prefix("id:") {
            let val = rest.trim();
            // Unquoted
            if val == comment_id {
                return true;
            }
            // Double-quoted: "value"
            if val.starts_with('"') && val.ends_with('"') && val.len() >= 2 {
                if &val[1..val.len() - 1] == comment_id {
                    return true;
                }
            }
            // Single-quoted: 'value'
            if val.starts_with('\'') && val.ends_with('\'') && val.len() >= 2 {
                if &val[1..val.len() - 1] == comment_id {
                    return true;
                }
            }
            return false; // id: found but value didn't match
        }
    }
    false
}

// ── Field setters ─────────────────────────────────────────────────────

/// Replace a scalar field's value within `yaml[block_start..block_end]`.
/// Returns the full modified YAML string, or `None` if the field wasn't
/// found in the block.
fn set_field_in_block(
    yaml: &str,
    block_start: usize,
    block_end: usize,
    field: &str,
    new_value: &str,
) -> Option<String> {
    let block = &yaml[block_start..block_end];
    let needle = format!("{}:", field);

    for line in block.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix(&needle) {
            if rest.is_empty() || rest.starts_with(' ') {
                // Found the field line. Compute absolute offset.
                let line_offset_in_block = line.as_ptr() as usize - block.as_ptr() as usize;
                let abs_line_start = block_start + line_offset_in_block;
                let abs_line_end = abs_line_start + line.len();

                // Rebuild the line: preserve leading whitespace + key + ": " + new_value
                let leading_ws_len = line.len() - line.trim_start().len();
                let leading_ws = &line[..leading_ws_len];
                let new_line = format!("{}{}: {}", leading_ws, field, new_value);

                let mut result = String::with_capacity(yaml.len() + new_value.len());
                result.push_str(&yaml[..abs_line_start]);
                result.push_str(&new_line);
                result.push_str(&yaml[abs_line_end..]);
                return Some(result);
            }
        }
    }
    None
}

/// Append an entry to a sequence field (e.g. `responses:`) within a
/// comment block.  Handles three cases:
///   1. Field exists with items → append after last item
///   2. Field exists but empty (inline `[]` or bare key) → replace with
///      a block sequence containing the new entry
///   3. Field absent → insert it before the block end with the new entry
fn append_to_sequence_in_block(
    yaml: &str,
    block_start: usize,
    block_end: usize,
    field: &str,
    new_entry: &str,
) -> Option<String> {
    let block = &yaml[block_start..block_end];
    let needle = format!("{}:", field);

    // Determine the comment entry's base indent (the `- ` line).
    let first_line = block.lines().next()?;
    let base_indent = first_line.len() - first_line.trim_start().len();

    // Detect actual field indent from existing fields in the block.
    // Falls back to base + 4 if detection fails.
    let field_indent = block
        .lines()
        .skip(1)
        .find(|l| !l.trim().is_empty())
        .map(|l| l.len() - l.trim_start().len())
        .unwrap_or(base_indent + 4);
    let item_indent = field_indent + 2;

    let field_ws: String = " ".repeat(field_indent);
    let item_ws: String = " ".repeat(item_indent);

    // Search for the field line within the block.
    let mut field_line_offset: Option<usize> = None;
    for line in block.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix(&needle) {
            if rest.is_empty() || rest.starts_with(' ') {
                field_line_offset =
                    Some(line.as_ptr() as usize - block.as_ptr() as usize);
                break;
            }
        }
    }

    match field_line_offset {
        Some(fl_off) => {
            let abs_field_line = block_start + fl_off;
            let field_line = block[fl_off..]
                .lines()
                .next()
                .unwrap();
            let rest = field_line.trim().strip_prefix(&needle)?.trim();

            if rest == "[]" {
                // Case 2: empty inline sequence → replace with block.
                let abs_line_end = abs_field_line + field_line.len();
                let new_content = format!(
                    "{}{field}:\n{item_ws}- {new_entry}",
                    field_ws,
                    field = field,
                    item_ws = item_ws,
                    new_entry = new_entry,
                );
                let mut result = String::with_capacity(yaml.len() + new_content.len());
                result.push_str(&yaml[..abs_field_line]);
                result.push_str(&new_content);
                result.push_str(&yaml[abs_line_end..]);
                return Some(result);
            }

            // Case 1: field has (or will have) block items.
            // Walk lines after the field line to find the last sequence
            // item belonging to this field (lines at item_indent starting
            // with `- ` or continuation lines deeper than item_indent).
            let after_field = abs_field_line + field_line.len();
            let mut insert_pos = after_field; // just after field line
            let remaining = &yaml[after_field..block_end];

            for line in remaining.lines() {
                if line.trim().is_empty() {
                    insert_pos += line.len() + 1; // +1 for \n
                    continue;
                }
                let li = line.len() - line.trim_start().len();
                if li >= item_indent {
                    insert_pos += line.len() + 1;
                } else {
                    break;
                }
            }

            // Clamp insert_pos to not exceed yaml length.
            if insert_pos > yaml.len() {
                insert_pos = yaml.len();
            }

            let new_item = format!("\n{}- {}", item_ws, new_entry);
            let mut result = String::with_capacity(yaml.len() + new_item.len());
            result.push_str(&yaml[..insert_pos]);
            result.push_str(&new_item);
            result.push_str(&yaml[insert_pos..]);
            Some(result)
        }
        None => {
            // Case 3: field absent — insert before block_end.
            // We insert right before the end of this block.
            let new_section = format!(
                "\n{field_ws}{field}:\n{item_ws}- {new_entry}",
                field_ws = field_ws,
                field = field,
                item_ws = item_ws,
                new_entry = new_entry,
            );

            // Insert position: just before the trailing newline of the
            // last content line in the block (or at block_end).
            let insert_at = if block_end > 0 && yaml.as_bytes().get(block_end - 1) == Some(&b'\n')
            {
                block_end - 1
            } else {
                block_end
            };

            let mut result = String::with_capacity(yaml.len() + new_section.len());
            result.push_str(&yaml[..insert_at]);
            result.push_str(&new_section);
            result.push_str(&yaml[insert_at..]);
            Some(result)
        }
    }
}

// ── Mutation orchestrator ─────────────────────────────────────────────

/// Attempt format-preserving surgery for all `mutations` on the comment
/// identified by `comment_id`.  Returns `Some(modified_yaml)` on
/// success, `None` if any step fails.
pub fn try_patch(
    yaml: &str,
    comment_id: &str,
    mutations: &[CommentMutation],
) -> Option<String> {
    // Quick sanity: no empty input.
    if yaml.is_empty() || mutations.is_empty() {
        return None;
    }

    let mut result = yaml.to_string();

    for mutation in mutations {
        // Re-find block on each iteration because prior mutations may
        // have shifted byte offsets.
        let (start, end) = find_comment_block(&result, comment_id)?;

        result = match mutation {
            CommentMutation::SetResolved(resolved) => {
                let val = if *resolved { "true" } else { "false" };
                set_field_in_block(&result, start, end, "resolved", val)?
            }
            CommentMutation::AddResponse {
                author,
                text,
                timestamp,
            } => {
                // Compute continuation indent from the block.
                let block = &result[start..end];
                let cont_indent = block
                    .lines()
                    .skip(1)
                    .find(|l| !l.trim().is_empty())
                    .map(|l| l.len() - l.trim_start().len())
                    .unwrap_or(4)
                    + 2; // sequence items are 2 deeper than fields
                let entry = format_response_entry(author, text, timestamp, cont_indent + 2);
                append_to_sequence_in_block(
                    &result, start, end, "responses", &entry,
                )?
            }
        };
    }

    Some(result)
}

/// Format a response entry as multi-line YAML mapping fields.
/// The leading `- ` is supplied by `append_to_sequence_in_block`, so
/// the first field goes on the same line and continuation fields are
/// indented by `cont_indent` spaces.
fn format_response_entry(author: &str, text: &str, timestamp: &str, cont_indent: usize) -> String {
    let ws: String = " ".repeat(cont_indent);
    format!(
        "author: {author}\n{ws}text: {text}\n{ws}timestamp: '{timestamp}'",
        author = quote_if_needed(author),
        text = quote_if_needed(text),
        ws = ws,
        timestamp = timestamp,
    )
}

/// Double-quote a YAML scalar if it contains characters that would
/// confuse a plain scalar.  For simple alphanumeric values, return as-is.
fn quote_if_needed(s: &str) -> String {
    if s.is_empty()
        || s.contains(':')
        || s.contains('#')
        || s.contains('\n')
        || s.contains('\r')
        || s.contains('\t')
        || s.contains('\'')
        || s.contains('"')
        || s.contains('{')
        || s.contains('}')
        || s.contains('[')
        || s.contains(']')
        || s.contains(',')
        || s.contains('&')
        || s.contains('*')
        || s.contains('!')
        || s.contains('|')
        || s.contains('>')
        || s.contains('%')
        || s.contains('@')
        || s.contains('`')
        || s.starts_with(' ')
        || s.ends_with(' ')
    {
        // Order is load-bearing: replace `\\` first so backslashes introduced
        // by the later `\n` / `\r` / `\t` escapes are not themselves
        // double-escaped.
        format!(
            "\"{}\"",
            s.replace('\\', "\\\\")
                .replace('"', "\\\"")
                .replace('\n', "\\n")
                .replace('\r', "\\r")
                .replace('\t', "\\t")
        )
    } else {
        s.to_string()
    }
}

// ── Tests ─────────────────────────────────────────────────────────────

#[cfg(test)]
#[path = "yaml_surgery_tests.rs"]
mod tests;
