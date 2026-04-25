use std::collections::{HashMap, HashSet};

use crate::core::types::{CommentThread, MatchedComment};

fn is_root(comment: &MatchedComment) -> bool {
    match &comment.comment.reply_to {
        None => true,
        Some(s) => s.is_empty(),
    }
}

/// Group flat comments into threaded structures.
/// Root comments: no reply_to field (or reply_to is None/empty).
/// Replies to non-existent parents are promoted to root threads.
/// Replies within each thread sorted by timestamp ascending.
pub fn group_into_threads(comments: &[MatchedComment]) -> Vec<CommentThread> {
    let root_ids: HashSet<&str> = comments
        .iter()
        .filter(|c| is_root(c))
        .map(|c| c.comment.id.as_str())
        .collect();

    let mut replies_by_parent: HashMap<&str, Vec<MatchedComment>> = HashMap::new();
    let mut orphaned_replies: Vec<MatchedComment> = Vec::new();

    for c in comments {
        if !is_root(c) {
            let parent_id = c.comment.reply_to.as_deref().unwrap_or("");
            if root_ids.contains(parent_id) {
                replies_by_parent
                    .entry(parent_id)
                    .or_default()
                    .push(c.clone());
            } else {
                orphaned_replies.push(c.clone());
            }
        }
    }

    for replies in replies_by_parent.values_mut() {
        replies.sort_by(|a, b| a.comment.timestamp.cmp(&b.comment.timestamp));
    }

    let roots = comments.iter().filter(|c| is_root(c));
    let all_roots = roots.chain(orphaned_replies.iter());

    all_roots
        .map(|root| CommentThread {
            root: root.clone(),
            replies: replies_by_parent
                .remove(root.comment.id.as_str())
                .unwrap_or_default(),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::types::MrsfComment;

    fn make_matched(id: &str, reply_to: Option<&str>, timestamp: &str) -> MatchedComment {
        MatchedComment {
            comment: MrsfComment {
                id: id.to_string(),
                author: "test".to_string(),
                timestamp: timestamp.to_string(),
                text: format!("Comment {}", id),
                resolved: false,
                line: Some(1),
                end_line: None,
                start_column: None,
                end_column: None,
                selected_text: None,
                anchored_text: None,
                selected_text_hash: None,
                commit: None,
                comment_type: None,
                severity: None,
                reply_to: reply_to.map(|s| s.to_string()),
                ..Default::default()
            },
            matched_line_number: 1,
            is_orphaned: false,
            anchored_text: None,
        }
    }

    #[test]
    fn basic_threading() {
        let comments = vec![
            make_matched("r1", None, "2024-01-01T00:00:00Z"),
            make_matched("r2", None, "2024-01-01T00:01:00Z"),
            make_matched("c1", Some("r1"), "2024-01-01T00:02:00Z"),
            make_matched("c2", Some("r2"), "2024-01-01T00:03:00Z"),
        ];
        let threads = group_into_threads(&comments);
        assert_eq!(threads.len(), 2);
        assert_eq!(threads[0].root.comment.id, "r1");
        assert_eq!(threads[0].replies.len(), 1);
        assert_eq!(threads[0].replies[0].comment.id, "c1");
        assert_eq!(threads[1].root.comment.id, "r2");
        assert_eq!(threads[1].replies.len(), 1);
        assert_eq!(threads[1].replies[0].comment.id, "c2");
    }

    #[test]
    fn orphan_reply_promoted_to_root() {
        let comments = vec![
            make_matched("r1", None, "2024-01-01T00:00:00Z"),
            make_matched("orphan", Some("nonexistent"), "2024-01-01T00:05:00Z"),
        ];
        let threads = group_into_threads(&comments);
        assert_eq!(threads.len(), 2);
        assert_eq!(threads[0].root.comment.id, "r1");
        assert_eq!(threads[1].root.comment.id, "orphan");
        assert!(threads[1].replies.is_empty());
    }

    #[test]
    fn replies_sorted_by_timestamp() {
        let comments = vec![
            make_matched("root", None, "2024-01-01T00:00:00Z"),
            make_matched("late", Some("root"), "2024-01-01T00:10:00Z"),
            make_matched("early", Some("root"), "2024-01-01T00:01:00Z"),
            make_matched("mid", Some("root"), "2024-01-01T00:05:00Z"),
        ];
        let threads = group_into_threads(&comments);
        assert_eq!(threads.len(), 1);
        let reply_ids: Vec<&str> = threads[0]
            .replies
            .iter()
            .map(|r| r.comment.id.as_str())
            .collect();
        assert_eq!(reply_ids, vec!["early", "mid", "late"]);
    }

    #[test]
    fn no_replies() {
        let comments = vec![
            make_matched("a", None, "2024-01-01T00:00:00Z"),
            make_matched("b", None, "2024-01-01T00:01:00Z"),
            make_matched("c", None, "2024-01-01T00:02:00Z"),
        ];
        let threads = group_into_threads(&comments);
        assert_eq!(threads.len(), 3);
        for thread in &threads {
            assert!(thread.replies.is_empty());
        }
    }

    #[test]
    fn single_comment() {
        let comments = vec![make_matched("only", None, "2024-01-01T00:00:00Z")];
        let threads = group_into_threads(&comments);
        assert_eq!(threads.len(), 1);
        assert_eq!(threads[0].root.comment.id, "only");
        assert!(threads[0].replies.is_empty());
    }

    #[test]
    fn empty_input() {
        let threads = group_into_threads(&[]);
        assert!(threads.is_empty());
    }
}
