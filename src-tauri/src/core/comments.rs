use crate::core::types::{CommentAnchor, MrsfComment};

/// Filter to only unresolved comments.
pub fn filter_unresolved(comments: &[MrsfComment]) -> Vec<&MrsfComment> {
    comments.iter().filter(|c| !c.resolved).collect()
}

/// Format a single MRSF comment (raw YAML form, so unknown fields like
/// `responses` are preserved) for verbose CLI text output.
///
/// Output shape (one comment, indented two spaces):
/// ```text
///   [RESOLVED] [<id>] line <line>  [<type>] (<severity>)  <author> · <timestamp>
///     > <text line 1>
///     > <text line 2>
///     quoted: "<selected text, single-line, ≤80 chars>"
///     <responder> (<ts>): <response text>
/// ```
/// `[RESOLVED] ` is only emitted when the comment is resolved AND the caller
/// passed `include_resolved = true` (so unresolved-only output stays clean).
pub fn format_comment_text_verbose(
    comment: &serde_yaml_ng::Value,
    include_resolved: bool,
) -> String {
    let id = comment.get("id").and_then(|v| v.as_str()).unwrap_or("?");
    let line = comment
        .get("line")
        .and_then(|v| v.as_u64())
        .map(|n| n.to_string())
        .unwrap_or_else(|| "?".to_string());
    let ctype = comment
        .get("type")
        .and_then(|v| v.as_str())
        .unwrap_or("comment");
    let sev = comment
        .get("severity")
        .and_then(|v| v.as_str())
        .unwrap_or("normal");
    let author = comment
        .get("author")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown");
    let ts = comment
        .get("timestamp")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let text = comment.get("text").and_then(|v| v.as_str()).unwrap_or("");
    let resolved = comment
        .get("resolved")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let mut out = String::new();
    let prefix = if resolved && include_resolved {
        "[RESOLVED] "
    } else {
        ""
    };
    out.push_str(&format!(
        "  {}[{}] line {}  [{}] ({})  {} · {}\n",
        prefix, id, line, ctype, sev, author, ts
    ));
    for ln in text.lines() {
        out.push_str(&format!("    > {}\n", ln));
    }
    if let Some(sel) = comment.get("selected_text").and_then(|v| v.as_str()) {
        if !sel.is_empty() {
            let one_line: String = sel.replace(['\n', '\r'], " ");
            let truncated = if one_line.chars().count() > 80 {
                let s: String = one_line.chars().take(77).collect();
                format!("{}...", s)
            } else {
                one_line
            };
            out.push_str(&format!("    quoted: \"{}\"\n", truncated));
        }
    }
    if let Some(responses) = comment.get("responses").and_then(|v| v.as_sequence()) {
        for r in responses {
            let r_author = r.get("author").and_then(|v| v.as_str()).unwrap_or("?");
            let r_ts = r.get("timestamp").and_then(|v| v.as_str()).unwrap_or("");
            let r_text = r.get("text").and_then(|v| v.as_str()).unwrap_or("");
            out.push_str(&format!("    {} ({}): {}\n", r_author, r_ts, r_text));
        }
    }
    out
}

/// Return current UTC time as ISO-8601 string with Z suffix.
pub fn iso_now() -> String {
    chrono::Utc::now()
        .format("%Y-%m-%dT%H:%M:%S%.3fZ")
        .to_string()
}

/// Generate a new UUIDv4 comment ID.
pub fn generate_comment_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

/// Create a new comment with generated ID and current timestamp.
pub fn create_comment(
    author: &str,
    text: &str,
    anchor: Option<CommentAnchor>,
    comment_type: Option<&str>,
    severity: Option<&str>,
) -> MrsfComment {
    let anchor = anchor.unwrap_or(CommentAnchor {
        line: 1,
        end_line: None,
        start_column: None,
        end_column: None,
        selected_text: None,
        selected_text_hash: None,
    });
    MrsfComment {
        id: generate_comment_id(),
        author: if author.is_empty() {
            "Anonymous".to_string()
        } else {
            author.to_string()
        },
        timestamp: iso_now(),
        text: text.to_string(),
        resolved: false,
        line: Some(anchor.line),
        end_line: anchor.end_line,
        start_column: anchor.start_column,
        end_column: anchor.end_column,
        selected_text: anchor.selected_text,
        anchored_text: None,
        selected_text_hash: anchor.selected_text_hash,
        commit: None,
        comment_type: comment_type.map(|s| s.to_string()),
        severity: severity.map(|s| s.to_string()),
        reply_to: None,
        ..Default::default()
    }
}

/// Create a reply to an existing comment.
pub fn create_reply(author: &str, text: &str, parent: &MrsfComment) -> MrsfComment {
    MrsfComment {
        id: generate_comment_id(),
        author: if author.is_empty() {
            "Anonymous".to_string()
        } else {
            author.to_string()
        },
        timestamp: iso_now(),
        text: text.to_string(),
        resolved: false,
        line: parent.line,
        end_line: None,
        start_column: None,
        end_column: None,
        selected_text: None,
        anchored_text: None,
        selected_text_hash: None,
        commit: None,
        comment_type: None,
        severity: None,
        reply_to: Some(parent.id.clone()),
        ..Default::default()
    }
}

/// Delete a comment from a list, promoting its direct replies per MRSF §9.1.
/// Returns the modified comment list without the deleted comment.
pub fn delete_comment(comments: &[MrsfComment], id: &str) -> Vec<MrsfComment> {
    let parent = match comments.iter().find(|c| c.id == id) {
        Some(p) => p.clone(),
        None => return comments.to_vec(),
    };

    comments
        .iter()
        .filter(|c| c.id != id)
        .map(|c| {
            if c.reply_to.as_deref() != Some(id) {
                return c.clone();
            }
            let mut updated = c.clone();
            // Inherit targeting fields from parent if reply omits them
            if updated.line.is_none() && parent.line.is_some() {
                updated.line = parent.line;
            }
            if updated.end_line.is_none() && parent.end_line.is_some() {
                updated.end_line = parent.end_line;
            }
            if updated.start_column.is_none() && parent.start_column.is_some() {
                updated.start_column = parent.start_column;
            }
            if updated.end_column.is_none() && parent.end_column.is_some() {
                updated.end_column = parent.end_column;
            }
            if updated.selected_text.is_none() && parent.selected_text.is_some() {
                updated.selected_text = parent.selected_text.clone();
                if parent.selected_text_hash.is_some() {
                    updated.selected_text_hash = parent.selected_text_hash.clone();
                }
            }
            // Reparent to grandparent (or remove reply_to if parent was root)
            updated.reply_to = parent.reply_to.clone();
            updated
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::types::MrsfComment;

    fn make_comment(id: &str, resolved: bool) -> MrsfComment {
        MrsfComment {
            id: id.to_string(),
            author: "test".to_string(),
            timestamp: "2025-01-01T00:00:00Z".to_string(),
            text: "text".to_string(),
            resolved,
            line: None,
            end_line: None,
            start_column: None,
            end_column: None,
            selected_text: None,
            anchored_text: None,
            selected_text_hash: None,
            commit: None,
            comment_type: None,
            severity: None,
            reply_to: None,
            ..Default::default()
        }
    }

    fn make_comment_with_line(id: &str, line: u32, reply_to: Option<&str>) -> MrsfComment {
        MrsfComment {
            id: id.to_string(),
            author: "test".to_string(),
            timestamp: "2025-01-01T00:00:00Z".to_string(),
            text: format!("Comment {}", id),
            resolved: false,
            line: Some(line),
            end_line: Some(line),
            start_column: Some(0),
            end_column: Some(10),
            selected_text: Some("selected".to_string()),
            anchored_text: None,
            selected_text_hash: Some("hash123".to_string()),
            commit: None,
            comment_type: None,
            severity: None,
            reply_to: reply_to.map(|s| s.to_string()),
            ..Default::default()
        }
    }

    #[test]
    fn filter_unresolved_works() {
        let comments = vec![
            make_comment("c1", false),
            make_comment("c2", true),
            make_comment("c3", false),
        ];
        let unresolved = filter_unresolved(&comments);
        assert_eq!(unresolved.len(), 2);
        assert_eq!(unresolved[0].id, "c1");
        assert_eq!(unresolved[1].id, "c3");
    }

    #[test]
    fn filter_unresolved_empty() {
        let comments: Vec<MrsfComment> = vec![];
        let unresolved = filter_unresolved(&comments);
        assert!(unresolved.is_empty());
    }

    #[test]
    fn format_comment_text_verbose_renders_header_and_body() {
        let yaml = r#"
id: c1
author: alice
timestamp: 2025-01-02T03:04:05Z
text: "first line\nsecond line"
resolved: false
line: 7
type: issue
severity: high
selected_text: "fn main() { foo(); }"
"#;
        let v: serde_yaml_ng::Value = serde_yaml_ng::from_str(yaml).unwrap();
        let out = format_comment_text_verbose(&v, false);
        assert!(out.contains("[c1] line 7  [issue] (high)  alice · 2025-01-02T03:04:05Z"));
        assert!(out.contains("    > first line"));
        assert!(out.contains("    > second line"));
        assert!(out.contains("quoted: \"fn main() { foo(); }\""));
        assert!(!out.contains("[RESOLVED]"));
    }

    #[test]
    fn format_comment_text_verbose_resolved_prefix_only_with_include() {
        let yaml = r#"
id: c1
author: a
timestamp: t
text: hi
resolved: true
"#;
        let v: serde_yaml_ng::Value = serde_yaml_ng::from_str(yaml).unwrap();
        assert!(format_comment_text_verbose(&v, true).contains("[RESOLVED] "));
        assert!(!format_comment_text_verbose(&v, false).contains("[RESOLVED]"));
    }

    #[test]
    fn format_comment_text_verbose_renders_responses() {
        let yaml = r#"
id: c1
author: a
timestamp: t
text: hi
resolved: false
responses:
  - author: bot
    timestamp: t2
    text: "ack"
"#;
        let v: serde_yaml_ng::Value = serde_yaml_ng::from_str(yaml).unwrap();
        let out = format_comment_text_verbose(&v, false);
        assert!(out.contains("    bot (t2): ack"));
    }

    #[test]
    fn format_comment_text_verbose_truncates_long_quoted() {
        let long: String = "x".repeat(200);
        let yaml = format!(
            "id: c1\nauthor: a\ntimestamp: t\ntext: hi\nresolved: false\nselected_text: \"{}\"\n",
            long
        );
        let v: serde_yaml_ng::Value = serde_yaml_ng::from_str(&yaml).unwrap();
        let out = format_comment_text_verbose(&v, false);
        // 77 x's + "..." inside quotes
        assert!(out.contains(&format!("\"{}...\"", "x".repeat(77))));
    }

    #[test]
    fn iso_now_format() {
        let now = iso_now();
        assert!(now.ends_with('Z'));
        assert!(now.contains('T'));
        assert!(now.len() >= 20);
    }

    #[test]
    fn generate_comment_id_is_uuid() {
        let id = generate_comment_id();
        assert_eq!(id.len(), 36); // UUID format: 8-4-4-4-12
        assert_eq!(id.chars().filter(|c| *c == '-').count(), 4);
    }

    #[test]
    fn generate_comment_id_unique() {
        let id1 = generate_comment_id();
        let id2 = generate_comment_id();
        assert_ne!(id1, id2);
    }

    #[test]
    fn create_comment_basic() {
        let c = create_comment("Alice", "Hello", None, None, None);
        assert_eq!(c.author, "Alice");
        assert_eq!(c.text, "Hello");
        assert!(!c.resolved);
        assert!(c.reply_to.is_none());
        assert!(c.timestamp.contains('T'));
    }

    #[test]
    fn create_comment_empty_author_becomes_anonymous() {
        let c = create_comment("", "text", None, None, None);
        assert_eq!(c.author, "Anonymous");
    }

    #[test]
    fn create_comment_with_anchor() {
        let anchor = CommentAnchor {
            line: 10,
            end_line: Some(12),
            start_column: Some(5),
            end_column: Some(20),
            selected_text: Some("hello".to_string()),
            selected_text_hash: Some("abc".to_string()),
        };
        let c = create_comment(
            "Bob",
            "Note",
            Some(anchor),
            Some("suggestion"),
            Some("high"),
        );
        assert_eq!(c.line, Some(10));
        assert_eq!(c.end_line, Some(12));
        assert_eq!(c.selected_text, Some("hello".to_string()));
        assert_eq!(c.comment_type, Some("suggestion".to_string()));
        assert_eq!(c.severity, Some("high".to_string()));
    }

    #[test]
    fn create_reply_basic() {
        let parent = make_comment_with_line("p1", 5, None);
        let reply = create_reply("Alice", "Reply text", &parent);
        assert_eq!(reply.reply_to, Some("p1".to_string()));
        assert_eq!(reply.line, Some(5)); // Inherits parent line
        assert_eq!(reply.text, "Reply text");
    }

    #[test]
    fn delete_comment_reparents_replies() {
        let parent = make_comment_with_line("p1", 5, None);
        let reply = MrsfComment {
            id: "r1".to_string(),
            reply_to: Some("p1".to_string()),
            line: None,
            end_line: None,
            start_column: None,
            end_column: None,
            selected_text: None,
            selected_text_hash: None,
            ..make_comment("r1", false)
        };
        let comments = vec![parent, reply];
        let result = delete_comment(&comments, "p1");
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].id, "r1");
        // Reply inherited parent's targeting fields
        assert_eq!(result[0].line, Some(5));
        assert_eq!(result[0].end_line, Some(5));
        assert_eq!(result[0].selected_text, Some("selected".to_string()));
        assert_eq!(result[0].selected_text_hash, Some("hash123".to_string()));
        // Reparented to root (parent had no reply_to)
        assert!(result[0].reply_to.is_none());
    }

    #[test]
    fn delete_comment_reparents_to_grandparent() {
        let grandparent = make_comment_with_line("gp", 1, None);
        let parent = make_comment_with_line("p1", 5, Some("gp"));
        let child = MrsfComment {
            id: "c1".to_string(),
            reply_to: Some("p1".to_string()),
            line: None,
            end_line: None,
            start_column: None,
            end_column: None,
            selected_text: None,
            selected_text_hash: None,
            ..make_comment("c1", false)
        };
        let comments = vec![grandparent, parent, child];
        let result = delete_comment(&comments, "p1");
        assert_eq!(result.len(), 2);
        let child_result = result.iter().find(|c| c.id == "c1").unwrap();
        assert_eq!(child_result.reply_to, Some("gp".to_string()));
    }

    #[test]
    fn delete_leaf_no_reparenting() {
        let parent = make_comment_with_line("p1", 5, None);
        let leaf = make_comment_with_line("leaf", 10, Some("p1"));
        let comments = vec![parent.clone(), leaf];
        let result = delete_comment(&comments, "leaf");
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].id, "p1");
    }

    #[test]
    fn delete_nonexistent_returns_unchanged() {
        let comments = vec![make_comment("c1", false)];
        let result = delete_comment(&comments, "nonexistent");
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].id, "c1");
    }
}
