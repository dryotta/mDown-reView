use criterion::{criterion_group, criterion_main, Criterion};
use mdown_review_lib::core::scanner;
use std::path::PathBuf;

fn fixture_path(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("target/bench-fixtures")
        .join(name)
}

fn bench_scan_review_files(c: &mut Criterion) {
    let mut group = c.benchmark_group("scanner");

    let small = fixture_path("small");
    if small.exists() {
        group.bench_function("flat_10_files", |b| {
            b.iter(|| scanner::find_review_files(&small.to_string_lossy(), 10000))
        });
    }

    let medium = fixture_path("medium");
    if medium.exists() {
        group.bench_function("flat_100_files", |b| {
            b.iter(|| scanner::find_review_files(&medium.to_string_lossy(), 10000))
        });
    }

    let large = fixture_path("large");
    if large.exists() {
        group.bench_function("nested_500_files", |b| {
            b.iter(|| scanner::find_review_files(&large.to_string_lossy(), 10000))
        });
    }

    group.finish();
}

criterion_group!(benches, bench_scan_review_files);
criterion_main!(benches);
