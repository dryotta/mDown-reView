//! Library-side helpers for the `mdownreview-cli` binary.
//!
//! The binary itself lives in `src-tauri/src/bin/cli.rs`; pieces that
//! benefit from being unit-testable by `cargo test` (without spawning
//! the binary) live here. Today this hosts the `analyze-log`
//! subcommand's parser and report rendering — both pure functions
//! over text input/output, ideal for table-driven testing.
//!
//! See `docs/specs/cli-mdownreview-cli.md` for the user-visible spec.

pub mod analyze_log;
