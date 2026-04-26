use criterion::{criterion_group, criterion_main, BatchSize, Criterion};
use mdown_review_lib::core::{sidecar, types::CommentMutation};
use std::path::PathBuf;
use tempfile::TempDir;

fn fixture_path(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("benches/fixtures")
        .join(name)
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

criterion_group!(
    benches,
    bench_load_sidecar,
    bench_save_sidecar,
    bench_patch_comment
);
criterion_main!(benches);
