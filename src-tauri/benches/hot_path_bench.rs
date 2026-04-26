use criterion::{criterion_group, criterion_main, Criterion};
use mdown_review_lib::core::{matching, sidecar, threads, types::MrsfComment};
use std::path::PathBuf;

fn fixture_path(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("benches/fixtures")
        .join(name)
}

fn bench_get_file_comments(c: &mut Criterion) {
    let mut group = c.benchmark_group("hot_path");

    // Small: load sidecar → match → thread for 100-line file
    let small_path = fixture_path("file_100_lines.md");
    let small_content = std::fs::read_to_string(&small_path).unwrap_or_default();
    let small_lines: Vec<&str> = small_content.lines().collect();

    if sidecar::load_sidecar(&small_path.to_string_lossy())
        .ok()
        .flatten()
        .is_some()
    {
        group.bench_function("get_file_comments_small", |b| {
            b.iter(|| {
                let s = sidecar::load_sidecar(&small_path.to_string_lossy())
                    .unwrap()
                    .unwrap();
                let matched = matching::match_comments(&s.comments, &small_lines);
                threads::group_into_threads(&matched)
            })
        });
    }

    // Large: 5000-line file with 200 synthetic comments (full hot-path without I/O)
    let large_path = fixture_path("file_5000_lines.md");
    let large_content = std::fs::read_to_string(&large_path).unwrap_or_default();
    let large_lines: Vec<&str> = large_content.lines().collect();

    let large_comments: Vec<MrsfComment> = (0..200)
        .map(|i: usize| {
            let line_idx = (i * 25).min(large_lines.len().saturating_sub(1));
            MrsfComment {
                id: format!("hot-{}", i),
                author: "bench".to_string(),
                timestamp: "2025-01-01T00:00:00Z".to_string(),
                text: format!("Hot path comment {}", i),
                resolved: i.is_multiple_of(5),
                line: Some((line_idx as u32) + 1),
                end_line: None,
                start_column: None,
                end_column: None,
                selected_text: large_lines.get(line_idx).map(|s| s.to_string()),
                anchored_text: None,
                selected_text_hash: None,
                commit: None,
                comment_type: None,
                severity: None,
                reply_to: None,
                ..Default::default()
            }
        })
        .collect();

    group.bench_function("get_file_comments_large", |b| {
        b.iter(|| {
            let matched = matching::match_comments(&large_comments, &large_lines);
            threads::group_into_threads(&matched)
        })
    });

    group.finish();
}

criterion_group!(benches, bench_get_file_comments);
criterion_main!(benches);
