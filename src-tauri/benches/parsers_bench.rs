//! Criterion benches for the pure Rust parser commands:
//! `compute_fold_regions`, `parse_kql_pipeline`, `strip_json_comments`.
//!
//! Inputs are generated synthetically so the bench is hermetic — no fixture
//! files required. Budgets are documented in `docs/performance.md`.

use criterion::{criterion_group, criterion_main, BenchmarkId, Criterion, Throughput};
use mdown_review_lib::core::{fold_regions, json, kql};

// ── synthetic inputs ────────────────────────────────────────────────────────

fn small_markdown() -> String {
    // ~100 lines with a fenced code block (exercises both indent and brace paths)
    let mut s = String::new();
    s.push_str("# Title\n\nIntro paragraph.\n\n");
    for i in 0..20 {
        s.push_str(&format!("## Section {}\n\nSome prose line {}.\n\n", i, i));
    }
    s.push_str("```rust\nfn main() {\n");
    for i in 0..30 {
        s.push_str(&format!("    let x{} = {{ {} }};\n", i, i));
    }
    s.push_str("}\n```\n");
    s
}

fn medium_braced(lines: usize) -> String {
    // Deeply nested brace structure of roughly `lines` lines.
    let mut s = String::with_capacity(lines * 32);
    let depth = 8usize;
    let mut written = 0usize;
    while written < lines {
        for d in 0..depth {
            let indent = "    ".repeat(d);
            s.push_str(&format!("{}fn f_{}_{}() {{\n", indent, written, d));
            written += 1;
            if written >= lines {
                break;
            }
        }
        for d in (0..depth).rev() {
            let indent = "    ".repeat(d);
            s.push_str(&format!("{}}}\n", indent));
            written += 1;
            if written >= lines {
                break;
            }
        }
    }
    s
}

fn large_jsonlike(approx_bytes: usize) -> String {
    let mut s = String::with_capacity(approx_bytes + 1024);
    s.push_str("{\n");
    let mut i = 0usize;
    while s.len() < approx_bytes {
        s.push_str(&format!(
            "  \"key_{i}\": {{\n    \"a\": {i},\n    \"b\": [1, 2, {{ \"c\": \"value_{i}\" }}]\n  }},\n",
            i = i
        ));
        i += 1;
    }
    s.push_str("  \"end\": true\n}\n");
    s
}

fn small_jsonc() -> String {
    // ~1 KB of JSONC with line + block comments and trailing commas
    let mut s = String::from("// top-level comment\n{\n");
    for i in 0..20 {
        s.push_str(&format!(
            "  /* block {i} */ \"k_{i}\": \"v // not a comment, /* nor */ this\", // trailing\n",
            i = i
        ));
    }
    s.push_str("  \"arr\": [1, 2, 3,], /* trailing comma in array */\n");
    s.push_str("  \"obj\": { \"x\": 1, },\n");
    s.push_str("}\n");
    s
}

fn large_jsonc(approx_bytes: usize) -> String {
    let mut s = String::with_capacity(approx_bytes + 1024);
    s.push_str("// generated\n{\n");
    let mut i = 0usize;
    while s.len() < approx_bytes {
        s.push_str(&format!(
            "  /* item {i} */ \"k_{i}\": {{ \"a\": {i}, \"s\": \"with // and /* embedded */\", }}, // line\n",
            i = i
        ));
        i += 1;
    }
    s.push_str("  \"end\": true,\n}\n");
    s
}

fn long_kql_pipeline(steps: usize) -> String {
    let mut s = String::from("MyTable");
    for i in 0..steps {
        s.push_str(&format!(
            " | where col_{i} > {i} and name == \"value | with pipe {i}\"",
            i = i
        ));
    }
    s
}

// ── benches ─────────────────────────────────────────────────────────────────

fn bench_fold_regions(c: &mut Criterion) {
    let mut group = c.benchmark_group("fold_regions");

    let small = small_markdown();
    let medium = medium_braced(5_000);
    let large = large_jsonlike(100 * 1024);

    let inputs: [(&str, &String); 3] = [
        ("small_100_lines", &small),
        ("medium_5000_lines_braced", &medium),
        ("large_100kb_jsonlike", &large),
    ];

    let langs = ["", "yaml", "python"];

    for (label, content) in inputs.iter() {
        group.throughput(Throughput::Bytes(content.len() as u64));
        for lang in langs.iter() {
            let id = BenchmarkId::new(*label, if lang.is_empty() { "default" } else { lang });
            group.bench_with_input(id, &(content.as_str(), *lang), |b, (c, l)| {
                b.iter(|| fold_regions::compute_fold_regions(c, l));
            });
        }
    }

    group.finish();
}

fn bench_parse_kql(c: &mut Criterion) {
    let mut group = c.benchmark_group("parse_kql");

    let short = "users | where age > 30";
    group.bench_function("short_2_steps", |b| {
        b.iter(|| kql::parse_kql_pipeline(short))
    });

    let long = long_kql_pipeline(50);
    group.throughput(Throughput::Bytes(long.len() as u64));
    group.bench_function("pipeline_50_steps", |b| {
        b.iter(|| kql::parse_kql_pipeline(&long))
    });

    group.finish();
}

fn bench_strip_json_comments(c: &mut Criterion) {
    let mut group = c.benchmark_group("strip_json_comments");

    let small = small_jsonc();
    group.throughput(Throughput::Bytes(small.len() as u64));
    group.bench_function("small_1kb", |b| {
        b.iter(|| json::strip_json_comments(&small))
    });

    let large = large_jsonc(100 * 1024);
    group.throughput(Throughput::Bytes(large.len() as u64));
    group.bench_function("large_100kb", |b| {
        b.iter(|| json::strip_json_comments(&large))
    });

    group.finish();
}

criterion_group!(
    benches,
    bench_fold_regions,
    bench_parse_kql,
    bench_strip_json_comments
);
criterion_main!(benches);
