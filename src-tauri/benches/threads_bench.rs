use criterion::{criterion_group, criterion_main, Criterion};
use mdown_review_lib::core::types::{MatchedComment, MrsfComment};
use mdown_review_lib::core::threads;

fn make_matched(id: &str, reply_to: Option<&str>, line: u32) -> MatchedComment {
    MatchedComment {
        comment: MrsfComment {
            id: id.to_string(),
            author: "bench".to_string(),
            timestamp: "2025-01-01T00:00:00Z".to_string(),
            text: format!("Comment {}", id),
            resolved: false,
            line: Some(line),
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
        matched_line_number: line,
        is_orphaned: false,
        anchored_text: None,
    }
}

fn bench_group_threads(c: &mut Criterion) {
    // ~100 comments: 30 root threads, each with 1-3 replies
    let mut comments = Vec::new();
    let mut reply_counter = 0u32;
    for t in 0u32..30 {
        let root_id = format!("root-{}", t);
        comments.push(make_matched(&root_id, None, t * 10 + 1));
        let reply_count = (t % 3) + 1;
        for r in 0..reply_count {
            reply_counter += 1;
            comments.push(make_matched(
                &format!("reply-{}", reply_counter),
                Some(&root_id),
                t * 10 + r + 2,
            ));
        }
    }

    c.bench_function("group_100_comments", |b| {
        b.iter(|| threads::group_into_threads(&comments))
    });
}

fn bench_group_threads_large(c: &mut Criterion) {
    // ~500 comments: 100 root threads, each with 2-5 replies
    let mut comments = Vec::new();
    let mut reply_counter = 0u32;
    for t in 0u32..100 {
        let root_id = format!("root-{}", t);
        comments.push(make_matched(&root_id, None, t * 5 + 1));
        let reply_count = (t % 4) + 2;
        for r in 0..reply_count {
            reply_counter += 1;
            comments.push(make_matched(
                &format!("reply-{}", reply_counter),
                Some(&root_id),
                t * 5 + r + 2,
            ));
        }
    }

    c.bench_function("group_500_comments", |b| {
        b.iter(|| threads::group_into_threads(&comments))
    });
}

criterion_group!(benches, bench_group_threads, bench_group_threads_large);
criterion_main!(benches);
