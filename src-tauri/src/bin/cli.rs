use clap::error::ErrorKind;
use clap::{CommandFactory, Parser, Subcommand};
use mdown_review_lib::cli::analyze_log::{
    analyze, evaluate_budgets, render_json, render_text, PhaseBudget,
};
use mdown_review_lib::core::types::CommentMutation;
use mdown_review_lib::core::paths::{self, canonicalize_no_verbatim};
use mdown_review_lib::core::{comments, scanner, sidecar};
use std::io;
use std::path::{Path, PathBuf};
use std::process::ExitCode;

/// Bundle identifier — must match `tauri.conf.json` `identifier` so the
/// default-path computation in `analyze-log` resolves to the same
/// directory the runtime logs to (verified by inspecting
/// `tauri::path::PathResolver::app_log_dir` against tauri-2.10.3).
/// If `tauri.conf.json` ever changes, update this constant too.
const APP_BUNDLE_ID: &str = "com.mdownreview.desktop";

/// Compute the default log-file path the runtime uses (Tauri's
/// `app_log_dir` + the `tauri-plugin-log` `file_name` configured in
/// `lib.rs::run`). This is platform-specific and mirrors the layout in
/// `tauri::path::PathResolver::app_log_dir`:
///
/// | Platform | Path |
/// |---|---|
/// | Linux   | `$XDG_DATA_HOME/<bundle_id>/logs/mdownreview.log` |
/// | macOS   | `$HOME/Library/Logs/<bundle_id>/mdownreview.log` |
/// | Windows | `%LOCALAPPDATA%/<bundle_id>/logs/mdownreview.log` |
///
/// Returns an error string when the OS-specific base dir is missing
/// (extremely rare — only on stripped-down sandbox environments).
fn default_log_path() -> Result<PathBuf, String> {
    #[cfg(target_os = "macos")]
    let base = dirs::home_dir()
        .ok_or_else(|| "cannot resolve home dir".to_string())?
        .join("Library/Logs")
        .join(APP_BUNDLE_ID);

    #[cfg(not(target_os = "macos"))]
    let base = dirs::data_local_dir()
        .ok_or_else(|| "cannot resolve local data dir".to_string())?
        .join(APP_BUNDLE_ID)
        .join("logs");

    Ok(base.join("mdownreview.log"))
}

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
    /// Aggregate `[ipc]` and `[startup]` events from the rotating log
    /// file. See `docs/specs/cli-mdownreview-cli.md` for the full spec.
    AnalyzeLog {
        /// Path to the log file (default: the runtime's standard
        /// rotating-log location, computed from the OS log dir).
        path: Option<String>,
        /// Read from stdin instead of a file. Mutually exclusive with
        /// the positional path.
        #[arg(long, conflicts_with = "path")]
        stdin: bool,
        /// Emit a JSON report (schema documented in
        /// `docs/specs/cli-mdownreview-cli.md`) instead of the
        /// human-readable text table.
        #[arg(long)]
        json: bool,
        /// Assert `<phase> t_ms <= <ms>`. Repeatable. On any breach the
        /// CLI exits non-zero (code `2`) after printing every breach
        /// to stderr. Phase names match the kebab-case wire form
        /// (`frontend-mounted`, `webview-ready`, …).
        #[arg(long = "phase-budget", value_name = "PHASE=MS")]
        phase_budget: Vec<String>,
    },
}

fn main() -> ExitCode {
    // Aggregated --help: when the user runs `mdownreview-cli --help` (no
    // subcommand), dump top-level help followed by long help for every
    // subcommand so the user sees every flag in one shot.
    let raw_args: Vec<String> = std::env::args().collect();
    let is_top_level_help =
        raw_args.len() <= 2 && raw_args.iter().skip(1).any(|a| a == "--help" || a == "-h");
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
    match cli.command {
        Commands::Read {
            folder,
            file,
            format,
            json,
            include_resolved,
        } => {
            let effective_format = if json { "json" } else { format.as_str() };
            ok_or_fail(cmd_read(folder, file, effective_format, include_resolved))
        }
        Commands::Respond {
            folder,
            file,
            comment_id,
            response,
            resolve,
        } => ok_or_fail(cmd_respond(
            folder,
            &file,
            &comment_id,
            response.as_deref(),
            resolve,
        )),
        Commands::Cleanup {
            folder,
            dry_run,
            include_unresolved,
        } => ok_or_fail(cmd_cleanup(folder, dry_run, include_unresolved)),
        Commands::AnalyzeLog {
            path,
            stdin,
            json,
            phase_budget,
        } => cmd_analyze_log(path, stdin, json, &phase_budget),
    }
}

/// Map a `Result<(), String>` to an `ExitCode`, printing the error to
/// stderr on failure. Used by every subcommand whose only failure mode
/// is operational ("error: …" → exit 1).
fn ok_or_fail(result: Result<(), String>) -> ExitCode {
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
    let canonical_root = canonicalize_no_verbatim(root).unwrap_or_else(|_| root.to_path_buf());
    let canonical_path = canonicalize_no_verbatim(path).unwrap_or_else(|_| path.to_path_buf());
    canonical_path
        .strip_prefix(&canonical_root)
        .map(|r| r.to_string_lossy().into_owned())
        .unwrap_or_else(|_| path.to_string_lossy().into_owned())
}

fn abs_str(path: &Path) -> String {
    canonicalize_no_verbatim(path)
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
    filtered_comments: &[serde_json::Value],
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

fn yaml_to_json(v: &serde_json::Value) -> serde_json::Value {
    v.clone()
}

/// Load raw YAML so we can preserve `responses` and other unknown fields
/// when rendering text output and emitting JSON.
fn load_raw_sidecar(sidecar_path: &Path) -> Result<serde_json::Value, String> {
    let content = std::fs::read_to_string(sidecar_path).map_err(|e| e.to_string())?;
    let s = sidecar_path.to_string_lossy();
    if s.ends_with(".review.json") {
        serde_json::from_str(&content).map_err(|e| e.to_string())
    } else {
        serde_saphyr::from_str(&content).map_err(|e| e.to_string())
    }
}

fn filter_raw_comments(
    raw: &serde_json::Value,
    include_resolved: bool,
) -> Vec<serde_json::Value> {
    raw.get("comments")
        .and_then(|v| v.as_array())
        .map(|seq| {
            seq.iter()
                .filter(|c| {
                    if include_resolved {
                        true
                    } else {
                        !c.get("resolved").and_then(|v| v.as_bool()).unwrap_or(false)
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
    // Load `.mrsf.yaml` once for the workspace so single-file resolution
    // (`resolve_sidecar_with_config`) and folder scanning agree on the
    // sidecar redirect. Silent fallback on parse errors — a malformed
    // `.mrsf.yaml` shouldn't make `mdownreview-cli read` exit non-zero
    // for users on workspaces they didn't author.
    let sidecar_root = paths::try_load_mrsf_config(&root);

    // Single-file mode: resolve and load exactly one sidecar; surface errors
    // (missing, outside-root, etc.) instead of silently skipping.
    if let Some(file_arg) = file.as_ref() {
        let sidecar_path = paths::resolve_sidecar_with_config(
            file_arg,
            folder.as_deref(),
            &cwd_path,
            sidecar_root.as_deref(),
        )?;
        // Use the redirect-aware helper so a sidecar under `.reviews/`
        // reports its real source location, not the non-existent path
        // inside the redirect folder.
        let source_path = paths::source_for_sidecar_with_config(
            &sidecar_path,
            &canonicalize_no_verbatim(&root).unwrap_or_else(|_| root.clone()),
            sidecar_root.as_deref(),
        )
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

    // Folder scan mode — share the GUI's primitive so the two surfaces
    // produce identical pairs and both honour `.mrsf.yaml`.
    let root_str = root.to_string_lossy().to_string();
    let files = scanner::scan_workspace(&root_str, 10_000);
    let mut entries: Vec<(serde_json::Value, Vec<serde_json::Value>)> = Vec::new();

    for (sidecar_str, source_str) in &files {
        let sidecar_path = PathBuf::from(sidecar_str);
        // Trust the source path emitted by `scan_workspace`: when a
        // `.mrsf.yaml` redirect is active it already maps `.reviews/`
        // sidecars back to the real source location. Re-deriving via
        // `paths::source_for_sidecar` would silently re-introduce the
        // ghost-misclassification bug for redirected workspaces.
        let source_path = PathBuf::from(source_str);
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
    filtered: &[serde_json::Value],
    include_resolved: bool,
) {
    let source_rel = entry["sourceFile"]["relative"].as_str().unwrap_or("?");
    let label = if include_resolved {
        "all"
    } else {
        "unresolved"
    };
    println!(
        "-- {} ({} {} comments) --",
        source_rel,
        filtered.len(),
        label
    );
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
    let root = root_dir(folder.as_deref());
    let sidecar_root = paths::try_load_mrsf_config(&root);
    let sidecar_path = paths::resolve_sidecar_with_config(
        file,
        folder.as_deref(),
        &cwd_path,
        sidecar_root.as_deref(),
    )?;
    // Drive `patch_comment_at` directly with the resolved YAML/JSON
    // paths so writes follow the `.mrsf.yaml` redirect — `patch_comment`
    // would synthesize co-located paths from the source file and miss
    // sidecars stored under `.reviews/`.
    let sidecar_str = sidecar_path
        .to_str()
        .ok_or_else(|| "error: non-utf8 sidecar path".to_string())?;
    let (yaml_path, json_path) = if let Some(stem) = sidecar_str.strip_suffix(".review.yaml") {
        (sidecar_str.to_string(), format!("{stem}.review.json"))
    } else if let Some(stem) = sidecar_str.strip_suffix(".review.json") {
        (format!("{stem}.review.yaml"), sidecar_str.to_string())
    } else {
        return Err(format!(
            "error: resolved sidecar does not have a .review.{{yaml,json}} suffix: {sidecar_str}"
        ));
    };

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

    sidecar::patch_comment_at(&yaml_path, &json_path, comment_id, &mutations)
        .map_err(|e| e.to_string())?;

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

// ── cmd_analyze_log ────────────────────────────────────────────────────────

/// Implement `mdownreview-cli analyze-log`. Owns its own `ExitCode`
/// mapping because budget breaches map to exit `2` (distinct from the
/// usual operational `1`) — see the spec in
/// `docs/specs/cli-mdownreview-cli.md`.
///
/// I/O strategy:
/// * `--stdin` reads from `io::stdin()` directly.
/// * positional `<path>` opens that file.
/// * neither: fall back to `default_log_path()` (the runtime's standard
///   rotating-log location).
fn cmd_analyze_log(
    path: Option<String>,
    stdin: bool,
    json: bool,
    phase_budget_strs: &[String],
) -> ExitCode {
    // Pre-parse every budget so a malformed flag fails fast (clap
    // usage error → exit 2).
    let mut budgets: Vec<PhaseBudget> = Vec::with_capacity(phase_budget_strs.len());
    for raw in phase_budget_strs {
        match PhaseBudget::parse(raw) {
            Ok(b) => budgets.push(b),
            Err(e) => {
                eprintln!("error: {e}");
                // Use exit 2 — same shape as clap's usage errors.
                return ExitCode::from(2);
            }
        }
    }

    let report = if stdin {
        match analyze(io::stdin().lock()) {
            Ok(r) => r,
            Err(e) => {
                eprintln!("error: reading stdin: {e}");
                return ExitCode::FAILURE;
            }
        }
    } else {
        let log_path: PathBuf = match path {
            Some(p) => PathBuf::from(p),
            None => match default_log_path() {
                Ok(p) => p,
                Err(e) => {
                    eprintln!("error: {e}");
                    return ExitCode::FAILURE;
                }
            },
        };
        match std::fs::File::open(&log_path) {
            Ok(file) => match analyze(file) {
                Ok(r) => r,
                Err(e) => {
                    eprintln!("error: parsing {}: {e}", log_path.display());
                    return ExitCode::FAILURE;
                }
            },
            Err(e) => {
                eprintln!("error: opening {}: {e}", log_path.display());
                return ExitCode::FAILURE;
            }
        }
    };

    if json {
        match render_json(&report) {
            Ok(s) => println!("{s}"),
            Err(e) => {
                eprintln!("error: rendering json: {e}");
                return ExitCode::FAILURE;
            }
        }
    } else {
        // `print!` not `println!` — render_text always ends with `\n`.
        print!("{}", render_text(&report));
    }

    let breaches = evaluate_budgets(&report, &budgets);
    if !breaches.is_empty() {
        for b in &breaches {
            eprintln!("{b}");
        }
        return ExitCode::from(2);
    }

    ExitCode::SUCCESS
}
