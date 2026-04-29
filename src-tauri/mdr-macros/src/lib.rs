//! Procedural attribute macro `#[mdr_command]`.
//!
//! Composes three things that every IPC entry point in the `mdown_review_lib`
//! crate needs:
//!
//! 1. `#[tauri::command]` registration with the Tauri runtime (so the function
//!    becomes invokable from the frontend).
//! 2. `#[specta::specta]` registration with the tauri-specta TypeScript
//!    binding generator (so `src/lib/bindings.ts` stays in lockstep with
//!    Rust signatures — issue #263).
//! 3. A tracing wrapper that records `[ipc] cmd=<name> duration_us=<u>
//!    payload_bytes=<n> ok=<bool>` (gated — see below) and triggers the
//!    `StartupPhase::FirstIpc` event on the first IPC ever, per
//!    issue #264 (engineering excellence — runtime tracing).
//!
//! Argument forwarding:
//! ```ignore
//! #[mdr_command]                               => #[tauri::command]
//! #[mdr_command(rename_all = "camelCase")]     => #[tauri::command(rename_all = "camelCase")]
//! ```
//!
//! ok-ness detection: if the function's return type starts with `Result`,
//! the ok=<bool> field reflects `result.is_ok()`. Otherwise it is unconditionally
//! `ok=true`. Errors are emitted at warn level with their Debug form,
//! sanitized to strip control characters that could be used for log-line
//! injection (see `startup_recorder::sanitize_err_for_log`).
//!
//! Gating, split by log level:
//!   * **warn-level err= lines** (the `Err` arm of a Result-returning
//!     command) are **always-on**. IPC errors are rare and are the
//!     highest-value production diagnostic the schema produces, so the
//!     cost of the format + plugin write is acceptable on a path that
//!     fires only on failure.
//!   * **info-level ok=true lines** (every successful call) are gated
//!     behind `cfg!(debug_assertions) || env::var("MDR_IPC_TRACE").is_ok()`,
//!     cached at first read via `startup_recorder::ipc_trace_enabled` so
//!     the steady-state cost of a successful IPC call in a release build
//!     with the env var unset is one relaxed atomic load + one branch —
//!     well under the `docs/performance.md` hot-path budget for hot
//!     commands like `search_in_document` and watcher callbacks.
//!
//! The `[startup]` events (only ~6 per process) remain always-on, as
//! does the first-IPC phase recording.
//!
//! `payload_bytes` is currently a stable `0` schema slot. Iter-2 of this
//! infrastructure may compute it from the IPC argument JSON; for now it
//! reserves the column so log-analyzer regexes can pin against the exact
//! field order.

use proc_macro::TokenStream;
use proc_macro2::TokenStream as TokenStream2;
use quote::quote;
use syn::{parse2, ItemFn, ReturnType, Type};

/// True if `ty` is `Result<...>` (with any path tail / generic args).
/// Used to decide whether the wrapper logs `ok=true|false` based on the
/// returned value's `is_ok()`, or unconditionally `ok=true` for non-Result
/// returns. Walking just the last path segment keeps the check robust
/// against `core::result::Result` / `std::result::Result` / `Result`
/// without false-positives on look-alike types.
fn is_result_type(ty: &Type) -> bool {
    if let Type::Path(tp) = ty {
        if let Some(last) = tp.path.segments.last() {
            return last.ident == "Result";
        }
    }
    false
}

/// `#[mdr_command]` — wrap a Tauri command with tracing instrumentation.
///
/// See the crate-level docs for argument forwarding rules and the on-disk
/// log schema.
#[proc_macro_attribute]
pub fn mdr_command(args: TokenStream, input: TokenStream) -> TokenStream {
    expand(args.into(), input.into()).into()
}

/// `proc_macro2`-based expansion entry point. Split out from
/// [`mdr_command`] so unit tests can drive the macro without the
/// `proc_macro` crate (which is only available inside a real
/// `#[proc_macro_attribute]` invocation).
fn expand(args: TokenStream2, input: TokenStream2) -> TokenStream2 {
    let input_fn: ItemFn = match parse2(input) {
        Ok(f) => f,
        Err(e) => return e.to_compile_error(),
    };

    let attrs = &input_fn.attrs;
    let vis = &input_fn.vis;
    let sig = &input_fn.sig;
    let block = &input_fn.block;
    let fn_name = &sig.ident;
    let fn_name_str = fn_name.to_string();

    let returns_result = match &sig.output {
        ReturnType::Default => false,
        ReturnType::Type(_, ty) => is_result_type(ty),
    };

    // Forward `#[mdr_command(rename_all = "camelCase")]` etc. directly to
    // `#[tauri::command(...)]`. Bare `#[mdr_command]` => `#[tauri::command]`.
    let tauri_cmd_attr = if args.is_empty() {
        quote! { #[tauri::command] }
    } else {
        quote! { #[tauri::command(#args)] }
    };

    // Emission policy split by level:
    //   * `log::warn!` (err=…) is **always-on** — IPC errors are rare and
    //     are the most valuable production diagnostic the schema produces.
    //     Sanitization (control-char strip + length bound) and the cmd=
    //     prefix block log-line forgery and bound size, so the always-on
    //     cost is acceptable for a path that fires only on failure.
    //   * `log::info!` (ok=true) is **gated** by `ipc_trace_enabled()`
    //     (cached `OnceLock<bool>`: `cfg!(debug_assertions) ||
    //     env::var("MDR_IPC_TRACE").is_ok()`). The success path is the
    //     hot path — `search_in_document`, watcher callbacks, etc. fire
    //     thousands of times per session, and we keep them within the
    //     `docs/performance.md` budget by skipping the format + plugin
    //     write in release builds with the env var unset.
    let log_call = if returns_result {
        quote! {
            match &__result {
                Ok(_) => {
                    if ::mdown_review_lib::startup_recorder::ipc_trace_enabled() {
                        log::info!(
                            target: "ipc",
                            "[ipc] cmd={} duration_us={} payload_bytes={} ok=true",
                            #fn_name_str, __dur_us, __payload_bytes
                        );
                    }
                }
                Err(e) => {
                    // Use Debug formatting for the err= field so typed
                    // discriminated-union errors (ConfigError, SystemError,
                    // CliShimError, ...) work without implementing Display
                    // — they all derive Debug. The Debug string is
                    // sanitized to strip control characters / ANSI
                    // escapes that could otherwise forge log lines
                    // through user-controllable error messages
                    // (e.g. `std::io::Error::to_string()` carries
                    // attacker-influenced path components) and bounded
                    // at 512 chars so a pathological payload cannot
                    // displace useful diagnostic context in the
                    // rotating log file.
                    log::warn!(
                        target: "ipc",
                        "[ipc] cmd={} duration_us={} payload_bytes={} ok=false err={}",
                        #fn_name_str, __dur_us, __payload_bytes,
                        ::mdown_review_lib::startup_recorder::sanitize_err_for_log(
                            &format!("{:?}", e)
                        )
                    );
                }
            }
        }
    } else {
        quote! {
            if ::mdown_review_lib::startup_recorder::ipc_trace_enabled() {
                log::info!(
                    target: "ipc",
                    "[ipc] cmd={} duration_us={} payload_bytes={} ok=true",
                    #fn_name_str, __dur_us, __payload_bytes
                );
            }
        }
    };

    // For sync fns: wrap the body in an immediately-invoked closure so
    // that early `return` / `?` propagation still hits the epilogue log.
    // The closure captures every parameter by reference (no `move`), which
    // avoids the `State<'_>` lifetime headaches that would arise from a
    // value-capturing `async move` block on async commands.
    //
    // For async fns: inline the body directly. The few `async fn` IPC
    // entry points in this codebase do not exercise complex early-return
    // logging (they either have a single fall-through `Ok(...)` shape, or
    // their `?` paths convert to `Err(String)` returns the surrounding
    // async fn already produces — the `__result` epilogue still observes
    // the failed Result via the function's normal return). Wrapping
    // `#block` in an inner `async move` block would bind every parameter
    // — including `State<'_, T>` — into the inner future, which the
    // borrow checker (correctly) rejects when the function's `'_` lifetime
    // is shorter than the `'static` future return.
    let is_async = sig.asyncness.is_some();
    let body_eval = if is_async {
        quote! { let __result = #block; }
    } else {
        quote! { let __result = (|| #block)(); }
    };
    let wrapped_body = quote! {
        {
            let __start = std::time::Instant::now();
            ::mdown_review_lib::startup_recorder::record_first_ipc();
            #body_eval
            let __dur_us = __start.elapsed().as_micros();
            // Reserved schema slot — Iter-2 will compute argument-payload
            // size when MDR_IPC_TRACE is set. Until then this is a stable
            // `0` so log-analyzer regexes can pin the field order.
            let __payload_bytes: usize = 0;
            #log_call
            __result
        }
    };

    quote! {
        #(#attrs)*
        #tauri_cmd_attr
        #[specta::specta]
        #vis #sig #wrapped_body
    }
}

#[cfg(test)]
mod tests {
    use super::expand;
    use quote::quote;

    /// Snapshot-style assertion that the macro emits both the
    /// `#[tauri::command]` and `#[specta::specta]` attributes (so the
    /// tauri-specta codegen pipeline keeps finding the function), the
    /// gated `[ipc]` log call, and the `record_first_ipc` hook into the
    /// startup recorder. Catches accidental drops of any composed
    /// attribute when the macro is refactored.
    #[test]
    fn expansion_includes_tauri_command_and_specta_and_log() {
        let out = expand(
            quote! {},
            quote! { fn check(path: String) -> bool { false } },
        )
        .to_string();
        assert!(out.contains("# [tauri :: command]"), "missing #[tauri::command]: {out}");
        assert!(out.contains("# [specta :: specta]"), "missing #[specta::specta]: {out}");
        assert!(out.contains("\"[ipc] cmd"), "missing [ipc] log call: {out}");
        assert!(
            out.contains("ipc_trace_enabled"),
            "missing ipc_trace_enabled gate (steady-state perf): {out}"
        );
        assert!(
            out.contains("record_first_ipc"),
            "missing record_first_ipc hook: {out}"
        );
    }

    /// Result-returning fns should expand to a `match` against the result
    /// so the warn-level err= line fires on `Err`. Non-Result returns
    /// should hit the simpler info-level always-ok branch.
    ///
    /// Note: assertions match the format-literal text inside the
    /// `log::warn!`/`log::info!` invocation (no whitespace inside string
    /// literals), not the surrounding tokenized expansion.
    #[test]
    fn result_return_expands_to_match_on_result() {
        let out = expand(
            quote! {},
            quote! { fn read(p: String) -> Result<String, String> { Ok(p) } },
        )
        .to_string();
        assert!(out.contains("match & __result"), "result fn missing match: {out}");
        assert!(
            out.contains("ok=false err="),
            "result fn missing err= line in log format string: {out}"
        );
        assert!(
            out.contains("sanitize_err_for_log"),
            "err= field must go through sanitizer to block log-line injection: {out}"
        );
    }

    /// Errors and warnings must always be logged in production — the
    /// warn-level err= line is NOT wrapped in the `ipc_trace_enabled()`
    /// gate. Only the info-level success branch is gated. Regression
    /// guard: if a future refactor accidentally moves the gate around
    /// the whole `match`, this test fails.
    #[test]
    fn err_arm_is_not_gated_by_ipc_trace() {
        let out = expand(
            quote! {},
            quote! { fn read(p: String) -> Result<String, String> { Ok(p) } },
        )
        .to_string();

        // The Ok arm sits inside the gate; the Err arm sits outside.
        // Token-stream of an unwrapped `Err (e) => { log :: warn ! (...) }`
        // appears verbatim in the expansion — wrapping it in
        // `if ipc_trace_enabled() { ... }` would inject the gate
        // identifier between `Err (e) =>` and `{ log :: warn`.
        let err_arm_pos = out.find("Err (e) =>").expect("Err arm missing");
        let after_err_arm = &out[err_arm_pos..err_arm_pos + 200];
        assert!(
            !after_err_arm.contains("ipc_trace_enabled"),
            "Err arm must NOT be gated — errors and warnings always log. \
             Found gate in: {after_err_arm}"
        );

        // Ok arm conversely SHOULD have the gate.
        let ok_arm_pos = out.find("Ok (_) =>").expect("Ok arm missing");
        let after_ok_arm = &out[ok_arm_pos..ok_arm_pos + 200];
        assert!(
            after_ok_arm.contains("ipc_trace_enabled"),
            "Ok arm must be gated by ipc_trace_enabled (hot-path budget). \
             Found in: {after_ok_arm}"
        );
    }

    #[test]
    fn non_result_return_uses_info_only() {
        let out = expand(
            quote! {},
            quote! { fn ping() -> u8 { 0 } },
        )
        .to_string();
        assert!(
            !out.contains("match & __result"),
            "non-result fn should not match: {out}"
        );
        assert!(
            !out.contains("ok=false"),
            "non-result fn should not emit err= branch in log format string: {out}"
        );
        assert!(
            out.contains("ok=true"),
            "non-result fn should always log ok=true: {out}"
        );
    }

    /// Argument forwarding: `#[mdr_command(rename_all = "camelCase")]`
    /// must reach the inner `#[tauri::command(...)]` so Tauri's case
    /// conversion still applies. Bare `#[mdr_command]` must NOT add
    /// stray parens.
    #[test]
    fn forwards_args_to_tauri_command() {
        let with_args = expand(
            quote! { rename_all = "camelCase" },
            quote! { fn x() -> u8 { 0 } },
        )
        .to_string();
        assert!(
            with_args.contains("# [tauri :: command (rename_all = \"camelCase\")]"),
            "missing forwarded args: {with_args}"
        );

        let bare = expand(quote! {}, quote! { fn x() -> u8 { 0 } }).to_string();
        assert!(
            bare.contains("# [tauri :: command]"),
            "bare mdr_command should expand to bare tauri::command: {bare}"
        );
        assert!(
            !bare.contains("# [tauri :: command ("),
            "bare mdr_command must not emit empty parens: {bare}"
        );
    }
}
