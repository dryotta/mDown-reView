//! Deterministic benchmark fixture generator for mdownreview performance tests.
//!
//! Run with: `cargo run --example generate_bench_fixtures`
//!
//! Generates MRSF YAML sidecars and source files in `benches/fixtures/`.

use rand::rngs::StdRng;
use rand::seq::SliceRandom;
use rand::Rng;
use rand::SeedableRng;
use std::fmt::Write as FmtWrite;
use std::fs;
use std::path::{Path, PathBuf};

const SEED: u64 = 42;

// ── Content pools ────────────────────────────────────────────────────────────

const AUTHORS: &[&str] = &[
    "Alice", "Bob", "Carol", "Dave", "Eve", "Frank", "Grace", "Heidi",
];

const REVIEW_COMMENTS: &[&str] = &[
    "Consider using `const` instead of `let` here.",
    "This could be simplified with a helper function.",
    "Nit: trailing whitespace.",
    "This allocation is unnecessary — use a slice reference instead.",
    "Missing error handling for the `None` case.",
    "Can we add a doc comment explaining the invariant?",
    "This loop could be replaced with an iterator chain.",
    "Magic number — extract to a named constant.",
    "Potential off-by-one: should this be `<` or `<=`?",
    "Thread-safety concern: this field is accessed from multiple threads.",
    "Nice refactor! Much cleaner now.",
    "Consider logging at `debug` level here for troubleshooting.",
    "This regex could be compiled once and reused.",
    "The function name doesn't match what it actually does.",
    "Typo in the variable name.",
    "Should we validate the input before processing?",
    "This match arm is unreachable.",
    "Prefer `expect()` with a message over bare `unwrap()`.",
    "The return type could be more specific.",
    "Performance: this clones a large struct on every iteration.",
];

const MARKDOWN_HEADINGS: &[&str] = &[
    "Introduction",
    "Getting Started",
    "Installation",
    "Configuration",
    "Usage",
    "API Reference",
    "Architecture",
    "Data Model",
    "Authentication",
    "Deployment",
    "Testing",
    "Troubleshooting",
    "Contributing",
    "Changelog",
    "License",
];

const CODE_FUNCTION_NAMES: &[&str] = &[
    "parse_config",
    "validate_input",
    "process_request",
    "build_response",
    "handle_error",
    "compute_hash",
    "serialize_payload",
    "deserialize_message",
    "authenticate_user",
    "authorize_action",
    "fetch_resource",
    "cache_result",
    "transform_data",
    "render_template",
    "dispatch_event",
    "schedule_task",
    "retry_operation",
    "compress_output",
    "merge_results",
    "format_report",
];

const RUST_TYPES: &[&str] = &[
    "String",
    "Vec<u8>",
    "HashMap<String, Value>",
    "Option<Config>",
    "Result<Response, Error>",
    "&str",
    "PathBuf",
    "Arc<Mutex<State>>",
    "Box<dyn Handler>",
    "usize",
];

// ── Generators ───────────────────────────────────────────────────────────────

fn gen_uuid(rng: &mut StdRng) -> String {
    let bytes: [u8; 16] = rng.gen();
    format!(
        "{:08x}-{:04x}-{:04x}-{:04x}-{:012x}",
        u32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]),
        u16::from_be_bytes([bytes[4], bytes[5]]),
        u16::from_be_bytes([bytes[6], bytes[7]]),
        u16::from_be_bytes([bytes[8], bytes[9]]),
        // 6 bytes → 48 bits
        ((bytes[10] as u64) << 40)
            | ((bytes[11] as u64) << 32)
            | ((bytes[12] as u64) << 24)
            | ((bytes[13] as u64) << 16)
            | ((bytes[14] as u64) << 8)
            | (bytes[15] as u64)
    )
}

fn gen_timestamp(rng: &mut StdRng) -> String {
    let month = rng.gen_range(1u32..=12);
    let day = rng.gen_range(1u32..=28);
    let hour = rng.gen_range(0u32..=23);
    let minute = rng.gen_range(0u32..=59);
    format!("2025-{month:02}-{day:02}T{hour:02}:{minute:02}:00Z")
}

/// Generate a markdown file with the given number of lines.
/// Returns the lines as a Vec for picking `selected_text` from.
pub fn generate_markdown_file(rng: &mut StdRng, line_count: usize) -> Vec<String> {
    let mut lines = Vec::with_capacity(line_count);
    let mut in_code_block = false;
    let mut i = 0;

    while i < line_count {
        let roll: f64 = rng.gen();

        if in_code_block {
            if roll < 0.15 || i >= line_count - 1 {
                lines.push("```".to_string());
                in_code_block = false;
            } else {
                let fname = CODE_FUNCTION_NAMES[rng.gen_range(0..CODE_FUNCTION_NAMES.len())];
                let rtype = RUST_TYPES[rng.gen_range(0..RUST_TYPES.len())];
                lines.push(format!("    let result: {} = {}(input);", rtype, fname));
            }
        } else if roll < 0.08 {
            let level = rng.gen_range(1u8..=4);
            let heading = MARKDOWN_HEADINGS[rng.gen_range(0..MARKDOWN_HEADINGS.len())];
            let hashes = "#".repeat(level as usize);
            lines.push(format!("{} {}", hashes, heading));
        } else if roll < 0.15 {
            lines.push("```rust".to_string());
            in_code_block = true;
        } else if roll < 0.25 {
            lines.push(String::new());
        } else if roll < 0.35 {
            let fname = CODE_FUNCTION_NAMES[rng.gen_range(0..CODE_FUNCTION_NAMES.len())];
            lines.push(format!(
                "The `{}` function handles the core transformation logic.",
                fname
            ));
        } else if roll < 0.45 {
            lines.push(format!(
                "- Item {}: configuration for {}",
                rng.gen_range(1u32..=100),
                MARKDOWN_HEADINGS[rng.gen_range(0..MARKDOWN_HEADINGS.len())].to_lowercase()
            ));
        } else {
            lines.push(format!(
                "This section documents the {} subsystem behavior under load. \
                 The implementation relies on {} for correctness.",
                MARKDOWN_HEADINGS[rng.gen_range(0..MARKDOWN_HEADINGS.len())].to_lowercase(),
                CODE_FUNCTION_NAMES[rng.gen_range(0..CODE_FUNCTION_NAMES.len())]
            ));
        }
        i += 1;
    }

    if in_code_block {
        if let Some(last) = lines.last_mut() {
            *last = "```".to_string();
        }
    }

    lines
}

/// Generate a source-code-like file with Rust/TypeScript patterns.
pub fn generate_source_file(rng: &mut StdRng, line_count: usize) -> Vec<String> {
    let mut lines = Vec::with_capacity(line_count);
    let mut i = 0;

    while i < line_count {
        let roll: f64 = rng.gen();

        if roll < 0.10 {
            let fname = CODE_FUNCTION_NAMES[rng.gen_range(0..CODE_FUNCTION_NAMES.len())];
            let rtype = RUST_TYPES[rng.gen_range(0..RUST_TYPES.len())];
            lines.push(format!("pub fn {}(input: &str) -> {} {{", fname, rtype));
        } else if roll < 0.15 {
            lines.push("}".to_string());
        } else if roll < 0.20 {
            lines.push(String::new());
        } else if roll < 0.30 {
            lines.push(format!(
                "    // TODO: refactor {} logic",
                CODE_FUNCTION_NAMES[rng.gen_range(0..CODE_FUNCTION_NAMES.len())]
            ));
        } else if roll < 0.45 {
            let fname = CODE_FUNCTION_NAMES[rng.gen_range(0..CODE_FUNCTION_NAMES.len())];
            let rtype = RUST_TYPES[rng.gen_range(0..RUST_TYPES.len())];
            lines.push(format!("    let result: {} = {}(&data);", rtype, fname));
        } else if roll < 0.55 {
            lines.push(format!(
                "    if count > {} {{ return Err(\"limit exceeded\".into()); }}",
                rng.gen_range(10u32..=1000)
            ));
        } else if roll < 0.65 {
            lines.push(format!(
                "    assert_eq!(expected, actual, \"mismatch at index {}\");",
                rng.gen_range(0u32..=99)
            ));
        } else if roll < 0.75 {
            lines.push(format!(
                "    println!(\"processing item {{}}\", {});",
                rng.gen_range(0u32..=999)
            ));
        } else {
            let fname = CODE_FUNCTION_NAMES[rng.gen_range(0..CODE_FUNCTION_NAMES.len())];
            lines.push(format!(
                "    let _ = {}.map(|v| v.to_string());",
                fname
            ));
        }
        i += 1;
    }

    lines
}

/// Escape YAML special characters in a string value.
fn yaml_escape(s: &str) -> String {
    if s.contains('"') || s.contains('\\') || s.contains('\n') || s.contains(':') || s.contains('#')
    {
        format!("\"{}\"", s.replace('\\', "\\\\").replace('"', "\\\""))
    } else {
        format!("\"{}\"", s)
    }
}

/// Generate MRSF YAML sidecar content for a given document name.
/// `file_lines` provides the actual file content for selected_text.
pub fn generate_sidecar_yaml(
    rng: &mut StdRng,
    document: &str,
    comment_count: usize,
    file_lines: &[String],
) -> String {
    let mut yaml = String::with_capacity(comment_count * 300);
    writeln!(yaml, "mrsf_version: \"1.0\"").unwrap();
    writeln!(yaml, "document: {}", yaml_escape(document)).unwrap();
    writeln!(yaml, "comments:").unwrap();

    let mut comment_ids: Vec<String> = Vec::with_capacity(comment_count);

    for idx in 0..comment_count {
        let id = gen_uuid(rng);
        let author = AUTHORS[rng.gen_range(0..AUTHORS.len())];
        let timestamp = gen_timestamp(rng);
        let text = REVIEW_COMMENTS[rng.gen_range(0..REVIEW_COMMENTS.len())];
        let resolved = rng.gen::<f64>() < 0.20;
        let line = if file_lines.is_empty() {
            rng.gen_range(1u32..=100)
        } else {
            rng.gen_range(1u32..=(file_lines.len() as u32))
        };
        let selected_text = if !file_lines.is_empty() {
            let line_idx = (line as usize).saturating_sub(1).min(file_lines.len() - 1);
            file_lines[line_idx].clone()
        } else {
            format!("line {} content", line)
        };

        // 30% of comments after the first are replies
        let is_reply = idx > 0 && rng.gen::<f64>() < 0.30;
        let reply_to = if is_reply {
            let parent_idx = rng.gen_range(0..comment_ids.len());
            Some(comment_ids[parent_idx].clone())
        } else {
            None
        };

        writeln!(yaml, "  - id: {}", yaml_escape(&id)).unwrap();
        writeln!(yaml, "    author: {}", yaml_escape(author)).unwrap();
        writeln!(yaml, "    timestamp: {}", yaml_escape(&timestamp)).unwrap();
        writeln!(yaml, "    text: {}", yaml_escape(text)).unwrap();
        writeln!(yaml, "    resolved: {}", resolved).unwrap();
        writeln!(yaml, "    line: {}", line).unwrap();
        writeln!(yaml, "    selected_text: {}", yaml_escape(&selected_text)).unwrap();
        if let Some(ref parent_id) = reply_to {
            writeln!(yaml, "    reply_to: {}", yaml_escape(parent_id)).unwrap();
        }

        comment_ids.push(id);
    }

    yaml
}

/// Generate all fixtures into the given output directory.
pub fn generate_fixtures(output_dir: &Path) -> std::io::Result<()> {
    let mut rng = StdRng::seed_from_u64(SEED);

    // ── Single files ─────────────────────────────────────────────────────

    // file_100_lines.md
    let lines_100 = generate_markdown_file(&mut rng, 100);
    let file_100_path = output_dir.join("file_100_lines.md");
    fs::create_dir_all(output_dir)?;
    fs::write(&file_100_path, lines_100.join("\n"))?;

    // comments_50.review.yaml
    let sidecar_50 = generate_sidecar_yaml(&mut rng, "file_100_lines.md", 50, &lines_100);
    fs::write(output_dir.join("comments_50.review.yaml"), &sidecar_50)?;

    // file_1000_lines.md
    let lines_1000 = generate_markdown_file(&mut rng, 1000);
    fs::write(output_dir.join("file_1000_lines.md"), lines_1000.join("\n"))?;

    // file_5000_lines.md (source-like)
    let lines_5000 = generate_source_file(&mut rng, 5000);
    fs::write(output_dir.join("file_5000_lines.md"), lines_5000.join("\n"))?;

    // ── Small directory: 10 .md files, 3 with sidecars of 10 comments ────

    let small_dir = output_dir.join("small");
    fs::create_dir_all(&small_dir)?;

    let mut small_files_with_sidecars: Vec<usize> = (0..10).collect();
    small_files_with_sidecars.shuffle(&mut rng);
    let sidecar_indices: Vec<usize> = small_files_with_sidecars[..3].to_vec();

    for i in 0..10 {
        let filename = format!("doc_{:02}.md", i);
        let lines = generate_markdown_file(&mut rng, 50);
        fs::write(small_dir.join(&filename), lines.join("\n"))?;

        if sidecar_indices.contains(&i) {
            let sidecar = generate_sidecar_yaml(&mut rng, &filename, 10, &lines);
            fs::write(
                small_dir.join(format!("{}.review.yaml", filename)),
                &sidecar,
            )?;
        }
    }

    // ── Medium directory: 100 .md files, 20 with sidecars of 50 comments ─

    let medium_dir = output_dir.join("medium");
    fs::create_dir_all(&medium_dir)?;

    let mut medium_indices: Vec<usize> = (0..100).collect();
    medium_indices.shuffle(&mut rng);
    let medium_sidecar_indices: Vec<usize> = medium_indices[..20].to_vec();

    for i in 0..100 {
        let filename = format!("module_{:03}.md", i);
        let lines = generate_markdown_file(&mut rng, 80);
        fs::write(medium_dir.join(&filename), lines.join("\n"))?;

        if medium_sidecar_indices.contains(&i) {
            let sidecar = generate_sidecar_yaml(&mut rng, &filename, 50, &lines);
            fs::write(
                medium_dir.join(format!("{}.review.yaml", filename)),
                &sidecar,
            )?;
        }
    }

    // ── Large directory: 500 files nested 5 levels, 100 with sidecars ────

    let large_dir = output_dir.join("large");
    fs::create_dir_all(&large_dir)?;

    let mut large_file_paths: Vec<PathBuf> = Vec::with_capacity(500);

    for i in 0..500u32 {
        // Distribute files across nested directories (5 levels)
        let d0 = i % 5;
        let d1 = (i / 5) % 5;
        let d2 = (i / 25) % 4;
        let d3 = (i / 100) % 3;
        let d4 = (i / 300) % 2;

        let nested = large_dir
            .join(format!("dir_{}", d0))
            .join(format!("dir_{}", d1))
            .join(format!("dir_{}", d2))
            .join(format!("dir_{}", d3))
            .join(format!("dir_{}", d4));
        fs::create_dir_all(&nested)?;

        let filename = format!("file_{:04}.md", i);
        let filepath = nested.join(&filename);
        let lines = generate_markdown_file(&mut rng, 40);
        fs::write(&filepath, lines.join("\n"))?;

        large_file_paths.push(filepath);
    }

    // Pick 100 random files to get sidecars
    large_file_paths.shuffle(&mut rng);
    for filepath in &large_file_paths[..100] {
        let filename = filepath.file_name().unwrap().to_str().unwrap();
        let sidecar_path = filepath.with_file_name(format!("{}.review.yaml", filename));
        let lines = generate_markdown_file(&mut rng, 40);
        let sidecar = generate_sidecar_yaml(&mut rng, filename, 50, &lines);
        fs::write(&sidecar_path, &sidecar)?;
    }

    Ok(())
}

fn main() {
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap_or_else(|_| ".".to_string());
    let output_dir = PathBuf::from(manifest_dir).join("benches").join("fixtures");

    if output_dir.exists() {
        fs::remove_dir_all(&output_dir).expect("failed to clean existing fixtures");
    }

    println!("Generating benchmark fixtures in {:?}", output_dir);
    generate_fixtures(&output_dir).expect("fixture generation failed");

    // Print summary
    let total = count_files_recursive(&output_dir);
    println!("Done. Generated {} files total.", total);
}

fn count_files_recursive(dir: &Path) -> usize {
    let mut count = 0;
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                count += count_files_recursive(&path);
            } else {
                count += 1;
            }
        }
    }
    count
}

// ── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;

    #[derive(Debug, Deserialize)]
    #[allow(dead_code)]
    struct TestMrsfSidecar {
        mrsf_version: String,
        document: String,
        comments: Vec<TestMrsfComment>,
    }

    #[derive(Debug, Deserialize)]
    #[allow(dead_code)]
    struct TestMrsfComment {
        id: String,
        author: String,
        timestamp: String,
        text: String,
        resolved: bool,
        line: u32,
        selected_text: String,
        #[serde(default)]
        reply_to: Option<String>,
    }

    fn count_files_with_ext(dir: &Path, ext: &str) -> usize {
        let mut count = 0;
        if let Ok(entries) = fs::read_dir(dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    count += count_files_with_ext(&path, ext);
                } else if path.to_str().map_or(false, |s| s.ends_with(ext)) {
                    count += 1;
                }
            }
        }
        count
    }

    fn count_sidecar_comments(path: &Path) -> usize {
        let content = fs::read_to_string(path).expect("read sidecar");
        let sidecar: TestMrsfSidecar = serde_yaml_ng::from_str(&content).expect("parse sidecar");
        sidecar.comments.len()
    }

    #[test]
    fn fixture_generation_is_deterministic() {
        let tmp1 = tempfile::tempdir().unwrap();
        let tmp2 = tempfile::tempdir().unwrap();

        generate_fixtures(tmp1.path()).unwrap();
        generate_fixtures(tmp2.path()).unwrap();

        let content1 =
            fs::read_to_string(tmp1.path().join("comments_50.review.yaml")).unwrap();
        let content2 =
            fs::read_to_string(tmp2.path().join("comments_50.review.yaml")).unwrap();
        assert_eq!(content1, content2, "fixture output must be deterministic");
    }

    #[test]
    fn top_level_single_files_exist() {
        let tmp = tempfile::tempdir().unwrap();
        generate_fixtures(tmp.path()).unwrap();

        assert!(tmp.path().join("file_100_lines.md").exists());
        assert!(tmp.path().join("file_1000_lines.md").exists());
        assert!(tmp.path().join("file_5000_lines.md").exists());
        assert!(tmp.path().join("comments_50.review.yaml").exists());
    }

    #[test]
    fn file_100_lines_has_correct_line_count() {
        let tmp = tempfile::tempdir().unwrap();
        generate_fixtures(tmp.path()).unwrap();

        let content = fs::read_to_string(tmp.path().join("file_100_lines.md")).unwrap();
        let line_count = content.lines().count();
        assert_eq!(line_count, 100);
    }

    #[test]
    fn file_1000_lines_has_correct_line_count() {
        let tmp = tempfile::tempdir().unwrap();
        generate_fixtures(tmp.path()).unwrap();

        let content = fs::read_to_string(tmp.path().join("file_1000_lines.md")).unwrap();
        let line_count = content.lines().count();
        assert_eq!(line_count, 1000);
    }

    #[test]
    fn file_5000_lines_has_correct_line_count() {
        let tmp = tempfile::tempdir().unwrap();
        generate_fixtures(tmp.path()).unwrap();

        let content = fs::read_to_string(tmp.path().join("file_5000_lines.md")).unwrap();
        let line_count = content.lines().count();
        assert_eq!(line_count, 5000);
    }

    #[test]
    fn comments_50_sidecar_is_valid_yaml() {
        let tmp = tempfile::tempdir().unwrap();
        generate_fixtures(tmp.path()).unwrap();

        let content =
            fs::read_to_string(tmp.path().join("comments_50.review.yaml")).unwrap();
        let sidecar: TestMrsfSidecar =
            serde_yaml_ng::from_str(&content).expect("sidecar must parse as valid YAML");

        assert_eq!(sidecar.mrsf_version, "1.0");
        assert_eq!(sidecar.document, "file_100_lines.md");
        assert_eq!(sidecar.comments.len(), 50);
    }

    #[test]
    fn comments_50_has_correct_resolved_ratio() {
        let tmp = tempfile::tempdir().unwrap();
        generate_fixtures(tmp.path()).unwrap();

        let content =
            fs::read_to_string(tmp.path().join("comments_50.review.yaml")).unwrap();
        let sidecar: TestMrsfSidecar = serde_yaml_ng::from_str(&content).unwrap();

        let resolved_count = sidecar.comments.iter().filter(|c| c.resolved).count();
        // 20% resolved = ~10 of 50, allow some variance from RNG
        assert!(resolved_count >= 3, "too few resolved: {}", resolved_count);
        assert!(resolved_count <= 20, "too many resolved: {}", resolved_count);
    }

    #[test]
    fn comments_50_has_replies() {
        let tmp = tempfile::tempdir().unwrap();
        generate_fixtures(tmp.path()).unwrap();

        let content =
            fs::read_to_string(tmp.path().join("comments_50.review.yaml")).unwrap();
        let sidecar: TestMrsfSidecar = serde_yaml_ng::from_str(&content).unwrap();

        let reply_count = sidecar.comments.iter().filter(|c| c.reply_to.is_some()).count();
        assert!(reply_count >= 5, "too few replies: {}", reply_count);
        assert!(reply_count <= 30, "too many replies: {}", reply_count);

        // Every reply_to must reference a valid comment id
        let ids: Vec<&str> = sidecar.comments.iter().map(|c| c.id.as_str()).collect();
        for comment in &sidecar.comments {
            if let Some(ref parent) = comment.reply_to {
                assert!(
                    ids.contains(&parent.as_str()),
                    "reply_to {} not found in comment ids",
                    parent
                );
            }
        }
    }

    #[test]
    fn small_directory_structure() {
        let tmp = tempfile::tempdir().unwrap();
        generate_fixtures(tmp.path()).unwrap();

        let small = tmp.path().join("small");
        assert!(small.is_dir());

        let md_count = count_files_with_ext(&small, ".md");
        assert_eq!(md_count, 10, "small/ should have 10 .md files");

        let sidecar_count = count_files_with_ext(&small, ".review.yaml");
        assert_eq!(sidecar_count, 3, "small/ should have 3 sidecars");

        // Each sidecar should have 10 comments
        for entry in fs::read_dir(&small).unwrap().flatten() {
            let path = entry.path();
            if path.to_str().map_or(false, |s| s.ends_with(".review.yaml")) {
                let count = count_sidecar_comments(&path);
                assert_eq!(count, 10, "small sidecar {:?} should have 10 comments", path);
            }
        }
    }

    #[test]
    fn medium_directory_structure() {
        let tmp = tempfile::tempdir().unwrap();
        generate_fixtures(tmp.path()).unwrap();

        let medium = tmp.path().join("medium");
        assert!(medium.is_dir());

        let md_count = count_files_with_ext(&medium, ".md");
        assert_eq!(md_count, 100, "medium/ should have 100 .md files");

        let sidecar_count = count_files_with_ext(&medium, ".review.yaml");
        assert_eq!(sidecar_count, 20, "medium/ should have 20 sidecars");

        // Each sidecar should have 50 comments
        for entry in fs::read_dir(&medium).unwrap().flatten() {
            let path = entry.path();
            if path.to_str().map_or(false, |s| s.ends_with(".review.yaml")) {
                let count = count_sidecar_comments(&path);
                assert_eq!(count, 50, "medium sidecar {:?} should have 50 comments", path);
            }
        }
    }

    #[test]
    fn large_directory_structure() {
        let tmp = tempfile::tempdir().unwrap();
        generate_fixtures(tmp.path()).unwrap();

        let large = tmp.path().join("large");
        assert!(large.is_dir());

        let md_count = count_files_with_ext(&large, ".md");
        assert_eq!(md_count, 500, "large/ should have 500 .md files");

        let sidecar_count = count_files_with_ext(&large, ".review.yaml");
        assert_eq!(sidecar_count, 100, "large/ should have 100 sidecars");
    }

    #[test]
    fn large_directory_has_nested_depth() {
        let tmp = tempfile::tempdir().unwrap();
        generate_fixtures(tmp.path()).unwrap();

        // Verify 5-level nesting exists (dir_N/dir_N/dir_N/dir_N/dir_N)
        let large = tmp.path().join("large");
        let deep_path = large
            .join("dir_0")
            .join("dir_0")
            .join("dir_0")
            .join("dir_0")
            .join("dir_0");
        assert!(
            deep_path.is_dir(),
            "5-level nesting should exist: {:?}",
            deep_path
        );
    }

    #[test]
    fn large_sidecars_have_50_comments() {
        let tmp = tempfile::tempdir().unwrap();
        generate_fixtures(tmp.path()).unwrap();

        let large = tmp.path().join("large");
        let mut checked = 0;
        check_sidecars_recursive(&large, &mut checked);
        assert_eq!(checked, 100, "should have verified all 100 large sidecars");
    }

    fn check_sidecars_recursive(dir: &Path, checked: &mut usize) {
        if let Ok(entries) = fs::read_dir(dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    check_sidecars_recursive(&path, checked);
                } else if path.to_str().map_or(false, |s| s.ends_with(".review.yaml")) {
                    let count = count_sidecar_comments(&path);
                    assert_eq!(
                        count, 50,
                        "large sidecar {:?} should have 50 comments",
                        path
                    );
                    *checked += 1;
                }
            }
        }
    }

    #[test]
    fn all_sidecars_parseable_by_serde_yaml_ng() {
        let tmp = tempfile::tempdir().unwrap();
        generate_fixtures(tmp.path()).unwrap();

        verify_all_sidecars_parseable(tmp.path());
    }

    fn verify_all_sidecars_parseable(dir: &Path) {
        if let Ok(entries) = fs::read_dir(dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    verify_all_sidecars_parseable(&path);
                } else if path.to_str().map_or(false, |s| s.ends_with(".review.yaml")) {
                    let content = fs::read_to_string(&path)
                        .unwrap_or_else(|e| panic!("read {:?}: {}", path, e));
                    let _sidecar: TestMrsfSidecar = serde_yaml_ng::from_str(&content)
                        .unwrap_or_else(|e| panic!("parse {:?}: {}", path, e));
                }
            }
        }
    }

    #[test]
    fn selected_text_matches_file_lines() {
        let tmp = tempfile::tempdir().unwrap();
        generate_fixtures(tmp.path()).unwrap();

        let file_content =
            fs::read_to_string(tmp.path().join("file_100_lines.md")).unwrap();
        let file_lines: Vec<&str> = file_content.lines().collect();

        let sidecar_content =
            fs::read_to_string(tmp.path().join("comments_50.review.yaml")).unwrap();
        let sidecar: TestMrsfSidecar = serde_yaml_ng::from_str(&sidecar_content).unwrap();

        for comment in &sidecar.comments {
            let line_idx = (comment.line as usize).saturating_sub(1);
            assert!(
                line_idx < file_lines.len(),
                "comment line {} out of bounds (file has {} lines)",
                comment.line,
                file_lines.len()
            );
            assert_eq!(
                comment.selected_text, file_lines[line_idx],
                "selected_text mismatch for comment {} at line {}",
                comment.id, comment.line
            );
        }
    }

    #[test]
    fn large_fixture_size_is_reasonable() {
        let tmp = tempfile::tempdir().unwrap();
        generate_fixtures(tmp.path()).unwrap();

        let total_size = dir_size_recursive(tmp.path());
        let five_mb = 5 * 1024 * 1024;
        assert!(
            total_size <= five_mb * 2,
            "total fixture size {}B exceeds 10MB limit",
            total_size
        );
    }

    fn dir_size_recursive(dir: &Path) -> u64 {
        let mut size = 0;
        if let Ok(entries) = fs::read_dir(dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    size += dir_size_recursive(&path);
                } else if let Ok(meta) = path.metadata() {
                    size += meta.len();
                }
            }
        }
        size
    }
}
