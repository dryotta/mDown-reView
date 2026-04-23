use clap::{Parser, Subcommand};
use mdown_review_lib::core::{comments, scanner, sidecar};
use mdown_review_lib::core::types::CommentMutation;
use std::path::Path;
use std::process::ExitCode;

#[derive(Parser)]
#[command(name = "mdownreview-cli", about = "Work with mdownreview MRSF sidecar files")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Show review comments from sidecar files
    Read {
        /// Root directory (default: cwd)
        #[arg(long)]
        folder: Option<String>,
        /// Output format
        #[arg(long, default_value = "text")]
        format: String,
        /// Include resolved comments
        #[arg(long)]
        all: bool,
    },
    /// Delete fully-resolved sidecar files
    Cleanup {
        /// Root directory (default: cwd)
        #[arg(long)]
        folder: Option<String>,
        /// Preview without deleting
        #[arg(long)]
        dry_run: bool,
    },
    /// Mark a comment as resolved
    Resolve {
        /// Path to the .review.yaml file
        review_file: String,
        /// Comment ID to resolve
        comment_id: String,
        /// Optional response message
        #[arg(long)]
        response: Option<String>,
    },
    /// Add a response to a comment without resolving
    Respond {
        /// Path to the .review.yaml file
        review_file: String,
        /// Comment ID to respond to
        comment_id: String,
        /// Response message (required)
        #[arg(long)]
        response: String,
    },
}

fn main() -> ExitCode {
    let cli = Cli::parse();
    let result = match cli.command {
        Commands::Read { folder, format, all } => cmd_read(folder, &format, all),
        Commands::Cleanup { folder, dry_run } => cmd_cleanup(folder, dry_run),
        Commands::Resolve { review_file, comment_id, response } => {
            cmd_resolve(&review_file, &comment_id, response.as_deref())
        }
        Commands::Respond { review_file, comment_id, response } => {
            cmd_respond(&review_file, &comment_id, &response)
        }
    };
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(msg) => {
            eprintln!("error: {}", msg);
            ExitCode::FAILURE
        }
    }
}

fn cmd_read(folder: Option<String>, format: &str, show_all: bool) -> Result<(), String> {
    let root = folder.unwrap_or_else(|| std::env::current_dir()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|_| ".".to_string()));

    let files = scanner::find_review_files(&root, 10_000);
    let mut output_entries: Vec<serde_json::Value> = Vec::new();

    for (sidecar_path, _source_path) in &files {
        let data = match scanner::load_review_file(sidecar_path) {
            Ok(d) => d,
            Err(e) => {
                eprintln!("warning: skipping {}: {}", sidecar_path, e);
                continue;
            }
        };

        let filtered: Vec<_> = if show_all {
            data.comments.clone()
        } else {
            comments::filter_unresolved(&data.comments)
                .into_iter()
                .cloned()
                .collect()
        };

        if filtered.is_empty() {
            continue;
        }

        let rel = match pathdiff(sidecar_path, &root) {
            Some(r) => r,
            None => sidecar_path.clone(),
        };
        let source = comments::source_file_for(sidecar_path);

        output_entries.push(serde_json::json!({
            "reviewFile": rel,
            "sourceFile": source,
            "comments": filtered,
        }));
    }

    if format == "json" {
        let json = serde_json::to_string_pretty(&output_entries).map_err(|e| e.to_string())?;
        println!("{}", json);
    } else {
        let label = if show_all { "comments" } else { "unresolved comments" };
        for entry in &output_entries {
            let source = entry["sourceFile"].as_str().unwrap_or("?");
            let cmts = entry["comments"].as_array().unwrap();
            println!("-- {} ({} {}) --", source, cmts.len(), label);
            for c in cmts {
                let line = c.get("line").and_then(|v| v.as_u64()).map(|v| v.to_string()).unwrap_or_else(|| "?".to_string());
                let mut prefix = String::new();
                if let Some(t) = c.get("type").and_then(|v| v.as_str()) {
                    prefix.push_str(&format!("[{}] ", t));
                }
                if let Some(s) = c.get("severity").and_then(|v| v.as_str()) {
                    prefix.push_str(&format!("({}) ", s));
                }
                let id = c["id"].as_str().unwrap_or("?");
                let text = c["text"].as_str().unwrap_or("");
                println!("  [{}] line {}: {}{}", id, line, prefix, text);
            }
        }
    }

    Ok(())
}

fn cmd_cleanup(folder: Option<String>, dry_run: bool) -> Result<(), String> {
    let root = folder.unwrap_or_else(|| std::env::current_dir()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|_| ".".to_string()));

    let files = scanner::find_review_files(&root, 10_000);
    let mut removed = 0;

    for (sidecar_path, _source_path) in &files {
        let data = match scanner::load_review_file(sidecar_path) {
            Ok(d) => d,
            Err(e) => {
                eprintln!("warning: skipping {}: {}", sidecar_path, e);
                continue;
            }
        };

        if data.comments.is_empty() {
            continue;
        }

        if data.comments.iter().all(|c| c.resolved) {
            let rel = match pathdiff(sidecar_path, &root) {
                Some(r) => r,
                None => sidecar_path.clone(),
            };
            if dry_run {
                println!("would delete: {}", rel);
            } else {
                if let Err(e) = std::fs::remove_file(sidecar_path) {
                    eprintln!("warning: failed to delete {}: {}", rel, e);
                    continue;
                }
                println!("deleted: {}", rel);
            }
            removed += 1;
        }
    }

    let action = if dry_run { "would delete" } else { "deleted" };
    println!("{} file(s) {}", removed, action);
    Ok(())
}

fn cmd_resolve(review_file: &str, comment_id: &str, response: Option<&str>) -> Result<(), String> {
    // Derive source file path from sidecar path for patch_comment
    let source_path = derive_source_path(review_file);

    let mut mutations = vec![CommentMutation::SetResolved(true)];
    if let Some(text) = response {
        mutations.push(CommentMutation::AddResponse {
            author: "agent".to_string(),
            text: text.to_string(),
            timestamp: comments::iso_now(),
        });
    }

    sidecar::patch_comment(&source_path, comment_id, &mutations).map_err(|e| e.to_string())?;
    let basename = Path::new(review_file).file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| review_file.to_string());
    println!("Resolved comment {} in {}", comment_id, basename);
    Ok(())
}

fn cmd_respond(review_file: &str, comment_id: &str, response: &str) -> Result<(), String> {
    let source_path = derive_source_path(review_file);

    let mutations = vec![CommentMutation::AddResponse {
        author: "agent".to_string(),
        text: response.to_string(),
        timestamp: comments::iso_now(),
    }];

    sidecar::patch_comment(&source_path, comment_id, &mutations).map_err(|e| e.to_string())?;
    let basename = Path::new(review_file).file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| review_file.to_string());
    println!("Added response to comment {} in {}", comment_id, basename);
    Ok(())
}

/// Derive the source file path from a sidecar path.
/// E.g., "path/to/file.md.review.yaml" → "path/to/file.md"
fn derive_source_path(sidecar_path: &str) -> String {
    if let Some(s) = sidecar_path.strip_suffix(".review.yaml") {
        return s.to_string();
    }
    if let Some(s) = sidecar_path.strip_suffix(".review.json") {
        return s.to_string();
    }
    sidecar_path.to_string()
}

/// Simple relative path calculation (avoids adding pathdiff crate).
fn pathdiff(path: &str, base: &str) -> Option<String> {
    let p = Path::new(path);
    let b = Path::new(base);
    p.strip_prefix(b).ok().map(|r| r.to_string_lossy().into_owned())
}
