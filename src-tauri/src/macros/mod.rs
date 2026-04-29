//! IPC tracing macro re-export.
//!
//! `#[mdr_command]` is defined in the sibling proc-macro crate
//! `mdr-macros` (proc-macros must live in their own crate per Rust's
//! `proc-macro = true` rule). This module re-exports it so callers can
//! use a stable `crate::mdr_command` path; `lib.rs` further re-exports
//! it at the crate root so call sites read `#[mdr_command]` rather than
//! `#[macros::mdr_command]`.
//!
//! See `mdr-macros/src/lib.rs` for the macro implementation, the on-disk
//! log schema, and the argument-forwarding rules. See also
//! `crate::startup_recorder` — the macro's expanded body calls
//! `record_first_ipc()` to drive the `StartupPhase::FirstIpc` event on
//! the very first IPC of the process.

pub use mdr_macros::mdr_command;
