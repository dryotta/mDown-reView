use clap::{CommandFactory, Parser, Subcommand};
use clap::error::ErrorKind;
use mdown_review_lib::core::types::CommentMutation;
use mdown_review_lib::core::{comments, paths, scanner, sidecar};
use std::path::{Path, PathBuf};
use std::process::ExitCode;

#[derive(Parser)]
#[command(
    name = "mdownreview-cli",
    about = "Work with mdownreview MRSF sidecar files"
)]
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
        /// Read a single source or sidecar file (relative to --folder or cwd)
        #[arg(long)]
        file: Option<String>,
        /// Output format: text (default) or json
        #[arg(long, default_value = "text")]
        format: String,
        /// Shorthand for --format json (overrides --format)
        #[arg(long)]
        json: bool,
        /// Include resolved comments in output
        #[arg(long)]
        include_resolved: bool,
    },
    /// Add a response and/or mark a comment resolved
    Respond {
        /// Root directory (default: cwd) — restricts file resolution
        #[arg(long)]
        folder: Option<String>,
        /// Source file or sidecar (relative to --folder or cwd, or absolute)
        file: String,
        /// Comment ID to respond to
        comment_id: String,
        /// Response message text
        #[arg(long)]
        response: Option<String>,
        /// Mark the comment as resolved
        #[arg(long)]
        resolve: bool,
    },
    /// Delete sidecar files whose comments are all resolved
    Cleanup {
        /// Root directory (default: cwd)
        #[arg(long)]
        folder: Option<String>,
        /// Preview deletions without removing files
        #[arg(long)]
        dry_run: bool,
        /// Also delete sidecars containing unresolved comments
        #[arg(long)]
        include_unresolved: bool,
    },
}

fn main() -> ExitCode {
    // Aggregated --help: when the user runs `mdownreview-cli --help` (no
    // subcommand), dump top-level help followed by long help for every
    // subcommand so the user sees every flag in one shot.
    let raw_args: Vec<String> = std::env::args().collect();
    let is_top_level_help = raw_args.len() <= 2
        && raw_args
            .iter()
            .skip(1)
            .any(|a| a == "--help" || a == "-h");
    if is_top_level_help {
        let mut cmd = Cli::command();
        let _ = cmd.print_long_help();
        println!();
        for sub in cmd.get_subcommands_mut() {
            println!("\n--- {} ---", sub.get_name());
            let _ = sub.print_long_help();
            println!();
        }
        return ExitCode::SUCCESS;
    }

    let cli = Cli::parse();
    let result = match cli.command {
        Commands::Read {
            folder,
            file,
            format,
            json,
            include_resolved,
        } => {
            let effective_format = if json { "json" } else { format.as_str() };
            cmd_read(folder, file, effective_format, include_resolved)
        }
        Commands::Respond {
            folder,
            file,
            comment_id,
            response,
            resolve,
        } => cmd_respond(folder, &file, &comment_id, response.as_deref(), resolve),
        Commands::Cleanup {
            folder,
            dry_run,
            include_unresolved,
        } => cmd_cleanup(folder, dry_run, include_unresolved),
    };
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(msg) => {
            eprintln!("error: {}", msg);
            ExitCode::FAILURE
        }
    }
}

// ── helpers ─────────────────────────────────────────────────────────────────

fn cwd() -> PathBuf {
    std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
}

fn root_dir(folder: Option<&str>) -> PathBuf {
    folder.map(PathBuf::from).unwrap_or_else(cwd)
}

/// Compute a path relative to `root` if possible; otherwise stringify `path`.
fn rel_to(path: &Path, root: &Path) -> String {
    let canonical_root = std::fs::canonicalize(root).unwrap_or_else(|_| root.to_path_buf());
    let canonical_path = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    canonical_path
        .strip_prefix(&canonical_root)
        .map(|r| r.to_string_lossy().into_owned())
        .unwrap_or_else(|_| path.to_string_lossy().into_owned())
}

fn abs_str(path: &Path) -> String {
    std::fs::canonicalize(path)
        .unwrap_or_else(|_| path.to_path_buf())
        .to_string_lossy()
        .into_owned()
}

/// Build the JSON envelope `{ reviewFile, sourceFile, comments }` for one
/// sidecar. `filtered_comments` is the post-filter raw comment sequence,
/// passed through as-is so unknown fields (e.g. `responses`) survive.
fn build_entry(
    sidecar_path: &Path,
    source_path: &Path,
    root: &Path,
    filtered_comments: &[serde_yaml_ng::Value],
) -> serde_json::Value {
    let comments_json: Vec<serde_json::Value> =
        filtered_comments.iter().map(yaml_to_json).collect();
    serde_json::json!({
        "reviewFile": {
            "relative": rel_to(sidecar_path, root),
            "absolute": abs_str(sidecar_path),
        },
        "sourceFile": {
            "relative": rel_to(source_path, root),
            "absolute": abs_str(source_path),
        },
        "comments": comments_json,
    })
}

fn yaml_to_json(v: &serde_yaml_ng::Value) -> serde_json::Value {
    serde_json::to_value(v).unwrap_or(serde_json::Value::Null)
}

/// Load raw YAML so we can preserve `responses` and other unknown fields
/// when rendering text output and emitting JSON.
fn load_raw_sidecar(sidecar_path: &Path) -> Result<serde_yaml_ng::Value, String> {
    let content = std::fs::read_to_string(sidecar_path).map_err(|e| e.to_string())?;
    let s = sidecar_path.to_string_lossy();
    if s.ends_with(".review.json") {
        let json_val: serde_json::Value =
            serde_json::from_str(&content).map_err(|e| e.to_string())?;
        serde_json::from_value::<serde_yaml_ng::Value>(json_val).map_err(|e| e.to_string())
    } else {
        serde_yaml_ng::from_str(&content).map_err(|e| e.to_string())
    }
}

fn filter_raw_comments(
    raw: &serde_yaml_ng::Value,
    include_resolved: bool,
) -> Vec<serde_yaml_ng::Value> {
    raw.get("comments")
        .and_then(|v| v.as_sequence())
        .map(|seq| {
            seq.iter()
                .filter(|c| {
                    if include_resolved {
                        true
                    } else {
                        !c.get("resolved")
                            .and_then(|v| v.as_bool())
                            .unwrap_or(false)
                    }
                })
                .cloned()
                .collect()
        })
        .unwrap_or_default()
}

// ── cmd_read ────────────────────────────────────────────────────────────────

fn cmd_read(
    folder: Option<String>,
    file: Option<String>,
    format: &str,
    include_resolved: bool,
) -> Result<(), String> {
    let cwd_path = cwd();
    let root = root_dir(folder.as_deref());

    // Single-file mode: resolve and load exactly one sidecar; surface errors
    // (missing, outside-root, etc.) instead of silently skipping.
    if let Some(file_arg) = file.as_ref() {
        let sidecar_path = paths::resolve_sidecar(file_arg, folder.as_deref(), &cwd_path)?;
        let source_path = paths::source_for_sidecar(&sidecar_path)
            .ok_or_else(|| format!("error: cannot derive source path from {:?}", sidecar_path))?;
        let raw = load_raw_sidecar(&sidecar_path)?;
        let filtered = filter_raw_comments(&raw, include_resolved);
        let entry = build_entry(&sidecar_path, &source_path, &root, &filtered);

        if format == "json" {
            let json = serde_json::to_string_pretty(&entry).map_err(|e| e.to_string())?;
            println!("{}", json);
        } else {
            print_text_entry(&entry, &filtered, include_resolved);
        }
        return Ok(());
    }

    // Folder scan mode.
    let root_str = root.to_string_lossy().to_string();
    let files = scanner::find_review_files(&root_str, 10_000);
    let mut entries: Vec<(serde_json::Value, Vec<serde_yaml_ng::Value>)> = Vec::new();

    for (sidecar_str, _src_str) in &files {
        let sidecar_path = PathBuf::from(sidecar_str);
        let source_path = match paths::source_for_sidecar(&sidecar_path) {
            Some(p) => p,
            None => continue,
        };
        let raw = match load_raw_sidecar(&sidecar_path) {
            Ok(r) => r,
            Err(e) => {
                eprintln!("warning: skipping {}: {}", sidecar_str, e);
                continue;
            }
        };
        let filtered = filter_raw_comments(&raw, include_resolved);
        if filtered.is_empty() {
            continue;
        }
        let entry = build_entry(&sidecar_path, &source_path, &root, &filtered);
        entries.push((entry, filtered));
    }

    if format == "json" {
        let arr: Vec<&serde_json::Value> = entries.iter().map(|(e, _)| e).collect();
        let json = serde_json::to_string_pretty(&arr).map_err(|e| e.to_string())?;
        println!("{}", json);
    } else {
        for (entry, filtered) in &entries {
            print_text_entry(entry, filtered, include_resolved);
        }
    }
    Ok(())
}

fn print_text_entry(
    entry: &serde_json::Value,
    filtered: &[serde_yaml_ng::Value],
    include_resolved: bool,
) {
    let source_rel = entry["sourceFile"]["relative"].as_str().unwrap_or("?");
    let label = if include_resolved { "all" } else { "unresolved" };
    println!("-- {} ({} {} comments) --", source_rel, filtered.len(), label);
    for c in filtered {
        print!(
            "{}",
            comments::format_comment_text_verbose(c, include_resolved)
        );
        println!();
    }
}

// ── cmd_respond ─────────────────────────────────────────────────────────────

fn cmd_respond(
    folder: Option<String>,
    file: &str,
    comment_id: &str,
    response: Option<&str>,
    resolve: bool,
) -> Result<(), String> {
    if response.is_none() && !resolve {
        let mut cmd = Cli::command();
        cmd.error(
            ErrorKind::MissingRequiredArgument,
            "must provide --response and/or --resolve",
        )
        .exit();
    }

    let cwd_path = cwd();
    let sidecar_path = paths::resolve_sidecar(file, folder.as_deref(), &cwd_path)?;
    let source_path = paths::source_for_sidecar(&sidecar_path)
        .ok_or_else(|| format!("error: cannot derive source path from {:?}", sidecar_path))?;
    let source_str = source_path
        .to_str()
        .ok_or_else(|| "error: non-utf8 source path".to_string())?;

    let mut mutations: Vec<CommentMutation> = Vec::new();
    if let Some(text) = response {
        mutations.push(CommentMutation::AddResponse {
            author: "agent".to_string(),
            text: text.to_string(),
            timestamp: comments::iso_now(),
        });
    }
    if resolve {
        mutations.push(CommentMutation::SetResolved(true));
    }

    sidecar::patch_comment(source_str, comment_id, &mutations).map_err(|e| e.to_string())?;

    let summary = match (response.is_some(), resolve) {
        (true, true) => format!("responded and resolved {}", comment_id),
        (true, false) => format!("responded to {}", comment_id),
        (false, true) => format!("resolved {}", comment_id),
        (false, false) => unreachable!("validated above"),
    };
    println!("{}", summary);
    Ok(())
}

// ── cmd_cleanup ─────────────────────────────────────────────────────────────

fn cmd_cleanup(
    folder: Option<String>,
    dry_run: bool,
    include_unresolved: bool,
) -> Result<(), String> {
    let root = root_dir(folder.as_deref());
    let report = scanner::delete_resolved_sidecars(&root, include_unresolved, dry_run)
        .map_err(|e| e.to_string())?;

    for path in &report.deleted {
        let rel = rel_to(path, &root);
        if dry_run {
            println!("would delete: {}", rel);
        } else {
            println!("deleted: {}", rel);
        }
    }
    let action = if dry_run { "would delete" } else { "deleted" };
    println!("{} file(s) {}", report.deleted.len(), action);
    Ok(())
}
