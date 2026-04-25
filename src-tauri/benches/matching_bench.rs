use criterion::{criterion_group, criterion_main, Criterion};
use mdown_review_lib::core::{
    matching,
    sidecar,
    types::MrsfComment,
};
use std::path::PathBuf;

fn fixture_path(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("benches/fixtures")
        .join(name)
}

fn load_file_lines(name: &str) -> Vec<String> {
    let path = fixture_path(name);
    std::fs::read_to_string(&path)
        .unwrap()
        .lines()
        .map(|s| s.to_string())
        .collect()
}

fn load_comments(source_file: &str) -> Vec<MrsfComment> {
    let path = fixture_path(source_file);
    match sidecar::load_sidecar(&path.to_string_lossy()).unwrap() {
        Some(s) => s.comments,
        None => vec![],
    }
}

fn synthetic_comments(lines: &[String], count: usize, stride: usize) -> Vec<MrsfComment> {
    (0..count)
        .map(|i| {
            let line_idx = (i * stride).min(lines.len().saturating_sub(1));
            MrsfComment {
                id: format!("synth-{}", i),
                author: "bench".to_string(),
                timestamp: "2025-01-01T00:00:00Z".to_string(),
                text: format!("Comment {}", i),
                resolved: false,
                line: Some((line_idx as u32) + 1),
                end_line: None,
                start_column: None,
                end_column: None,
                selected_text: lines.get(line_idx).cloned(),
                anchored_text: None,
                selected_text_hash: None,
                commit: None,
                comment_type: None,
                severity: None,
                reply_to: None,
                ..Default::default()
            }
        })
        .collect()
}

fn bench_match_comments(c: &mut Criterion) {
    let mut group = c.benchmark_group("matching");

    // Small: ~10 comments from fixture sidecar, 100 lines
    let small_lines = load_file_lines("file_100_lines.md");
    let small_lines_ref: Vec<&str> = small_lines.iter().map(|s| s.as_str()).collect();
    let small_comments = load_comments("file_100_lines.md");
    let small_subset: Vec<MrsfComment> = small_comments.into_iter().take(10).collect();

    group.bench_function("10_comments_100_lines", |b| {
        b.iter(|| matching::match_comments(&small_subset, &small_lines_ref))
    });

    // Medium: 50 synthetic comments, 1000 lines
    let med_lines = load_file_lines("file_1000_lines.md");
    let med_lines_ref: Vec<&str> = med_lines.iter().map(|s| s.as_str()).collect();
    let med_comments = synthetic_comments(&med_lines, 50, 20);

    group.bench_function("50_comments_1000_lines", |b| {
        b.iter(|| matching::match_comments(&med_comments, &med_lines_ref))
    });

    // Large: 200 synthetic comments, 5000 lines
    let large_lines = load_file_lines("file_5000_lines.md");
    let large_lines_ref: Vec<&str> = large_lines.iter().map(|s| s.as_str()).collect();
    let large_comments = synthetic_comments(&large_lines, 200, 25);

    group.bench_function("200_comments_5000_lines", |b| {
        b.iter(|| matching::match_comments(&large_comments, &large_lines_ref))
    });

    group.finish();
}

fn bench_levenshtein(c: &mut Criterion) {
    let a = "fn calculate_performance_metrics(data: &[f64]) -> PerformanceMetrics";
    let b = "fn calculate_perf_metrics(data: &[f64], config: &Config) -> PerfMetrics";

    c.bench_function("levenshtein_70_chars", |b_iter| {
        b_iter.iter(|| matching::levenshtein(a, b))
    });
}

fn bench_fuzzy_score(c: &mut Criterion) {
    let a = "fn calculate_performance_metrics(data: &[f64]) -> PerformanceMetrics";
    let b = "fn calculate_perf_metrics(data: &[f64], config: &Config) -> PerfMetrics";

    c.bench_function("fuzzy_score_70_chars", |b_iter| {
        b_iter.iter(|| matching::fuzzy_score(a, b))
    });
}

criterion_group!(benches, bench_match_comments, bench_levenshtein, bench_fuzzy_score);
criterion_main!(benches);
