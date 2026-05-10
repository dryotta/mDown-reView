use criterion::{criterion_group, criterion_main, BatchSize, Criterion};
use mdown_review_lib::core::{sidecar, types::CommentMutation};
use std::path::PathBuf;
use tempfile::TempDir;

fn fixture_path(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("target/bench-fixtures")
        .join(name)
}

/// Generate a YAML sidecar string with `n` comments in-memory.
/// Used for the 100-comment benches (AC14) so they are self-contained
/// and don't require the fixture generator to have been run.
fn generate_n_comment_yaml(n: usize) -> String {
    let mut yaml = String::from("mrsf_version: '1.0'\ndocument: bench.md\ncomments:\n");
    for i in 0..n {
        use std::fmt::Write;
        writeln!(yaml, "  - id: bench-{i}").unwrap();
        writeln!(yaml, "    author: bench-user").unwrap();
        writeln!(yaml, "    text: \"Comment number {i} for benchmarking\"").unwrap();
        writeln!(yaml, "    timestamp: '2024-01-01T00:00:00Z'").unwrap();
        writeln!(yaml, "    line: {}", i + 1).unwrap();
        writeln!(yaml, "    resolved: false").unwrap();
    }
    yaml
}

fn bench_load_sidecar(c: &mut Criterion) {
    let path = fixture_path("file_100_lines.md");
    assert!(
        sidecar::load_sidecar(&path.to_string_lossy())
            .ok()
            .flatten()
            .is_some(),
        "fixture sidecar missing — run fixture generator first"
    );

    c.bench_function("load_sidecar_50_comments", |b| {
        b.iter(|| sidecar::load_sidecar(&path.to_string_lossy()).unwrap())
    });
}

fn bench_save_sidecar(c: &mut Criterion) {
    let path = fixture_path("file_100_lines.md");
    let loaded = sidecar::load_sidecar(&path.to_string_lossy())
        .unwrap()
        .unwrap();
    let tmp = TempDir::new().unwrap();
    let tmp_file = tmp.path().join("bench_file.md");
    std::fs::write(&tmp_file, "dummy").unwrap();

    c.bench_function("save_sidecar_50_comments", |b| {
        b.iter(|| {
            sidecar::save_sidecar(
                &tmp_file.to_string_lossy(),
                &loaded.document,
                &loaded.comments,
            )
            .unwrap()
        })
    });
}

fn bench_patch_comment(c: &mut Criterion) {
    let path = fixture_path("file_100_lines.md");
    let loaded = sidecar::load_sidecar(&path.to_string_lossy())
        .unwrap()
        .unwrap();
    let first_id = loaded.comments[0].id.clone();
    let tmp = TempDir::new().unwrap();
    let tmp_file = tmp.path().join("patch_file.md");
    std::fs::write(&tmp_file, "dummy").unwrap();

    c.bench_function("patch_comment_resolve", |b| {
        b.iter_batched(
            || {
                sidecar::save_sidecar(
                    &tmp_file.to_string_lossy(),
                    &loaded.document,
                    &loaded.comments,
                )
                .unwrap();
            },
            |_| {
                sidecar::patch_comment(
                    &tmp_file.to_string_lossy(),
                    &first_id,
                    &[CommentMutation::SetResolved(true)],
                )
                .unwrap()
            },
            BatchSize::SmallInput,
        )
    });
}

// ── 100-comment benchmarks (AC12, AC13, AC14) ────────────────────────────────

fn bench_patch_comment_100(c: &mut Criterion) {
    let yaml = generate_n_comment_yaml(100);
    let tmp = TempDir::new().unwrap();
    let tmp_file = tmp.path().join("bench_100.md");
    std::fs::write(&tmp_file, "dummy").unwrap();
    let sidecar_path = tmp.path().join("bench_100.md.review.yaml");

    c.bench_function("patch_comment_100_comments", |b| {
        b.iter_batched(
            || {
                // Reset the sidecar before each iteration so we always
                // start from the same state.
                std::fs::write(&sidecar_path, &yaml).unwrap();
            },
            |_| {
                sidecar::patch_comment(
                    &tmp_file.to_string_lossy(),
                    "bench-50",
                    &[CommentMutation::SetResolved(true)],
                )
                .unwrap()
            },
            BatchSize::SmallInput,
        )
    });
}

fn bench_save_sidecar_100(c: &mut Criterion) {
    // Parse the 100-comment YAML to get typed MrsfComment values.
    let yaml = generate_n_comment_yaml(100);
    let tmp = TempDir::new().unwrap();
    let tmp_file = tmp.path().join("bench_save_100.md");
    std::fs::write(&tmp_file, "dummy").unwrap();
    let sidecar_path = tmp.path().join("bench_save_100.md.review.yaml");

    // Write + load to get the typed sidecar.
    std::fs::write(&sidecar_path, &yaml).unwrap();
    let loaded = sidecar::load_sidecar(&tmp_file.to_string_lossy())
        .unwrap()
        .unwrap();
    assert_eq!(
        loaded.comments.len(),
        100,
        "fixture must have exactly 100 comments"
    );

    c.bench_function("save_sidecar_100_comments", |b| {
        b.iter(|| {
            sidecar::save_sidecar(
                &tmp_file.to_string_lossy(),
                &loaded.document,
                &loaded.comments,
            )
            .unwrap()
        })
    });
}

fn bench_load_sidecar_100(c: &mut Criterion) {
    let yaml = generate_n_comment_yaml(100);
    let tmp = TempDir::new().unwrap();
    let tmp_file = tmp.path().join("bench_load_100.md");
    std::fs::write(&tmp_file, "dummy").unwrap();
    let sidecar_path = tmp.path().join("bench_load_100.md.review.yaml");
    std::fs::write(&sidecar_path, &yaml).unwrap();

    c.bench_function("load_sidecar_100_comments", |b| {
        b.iter(|| sidecar::load_sidecar(&tmp_file.to_string_lossy()).unwrap())
    });
}

criterion_group!(
    benches,
    bench_load_sidecar,
    bench_save_sidecar,
    bench_patch_comment,
    bench_patch_comment_100,
    bench_save_sidecar_100,
    bench_load_sidecar_100,
);
criterion_main!(benches);
