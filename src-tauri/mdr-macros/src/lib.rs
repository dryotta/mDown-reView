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
//!    payload_bytes=<n> ok=<bool>` on every call and triggers the
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
//! `ok=true`. Errors are emitted at warn level with their `Display` form.
//!
//! Implementation note: payload_bytes is currently always emitted as 0
//! (placeholder). Computing it per-call requires either a snapshot of the
//! arguments or post-processing of the on-wire JSON; both would either
//! double-allocate or hook below the IPC dispatcher. Iter-2 of this
//! infrastructure may revisit; for now PR3 ships the stable schema slot.

use proc_macro::TokenStream;
use quote::quote;
use syn::{parse_macro_input, ItemFn, ReturnType, Type};

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
    let input_fn = parse_macro_input!(input as ItemFn);

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
        let args = proc_macro2::TokenStream::from(args);
        quote! { #[tauri::command(#args)] }
    };

    // ok-ness branch: the body is inlined (sync) OR is the body of an
    // async fn (and `#[tauri::command]` handles async desugaring). Both
    // shapes share the same epilogue logging logic so we factor it once.
    //
    // `__result` is whatever `#block` evaluates to — `Result<T, E>` or `T`.
    // We branch on `returns_result` (compile-time) to drive the warn-on-error
    // arm; non-Result returns always log `ok=true`.
    let log_call = if returns_result {
        quote! {
            match &__result {
                Ok(_) => {
                    log::info!(
                        target: "ipc",
                        "[ipc] cmd={} duration_us={} payload_bytes={} ok=true",
                        #fn_name_str, __dur_us, __payload_bytes
                    );
                }
                Err(e) => {
                    // Use Debug formatting for the err= field so typed
                    // discriminated-union errors (ConfigError, SystemError,
                    // CliShimError, …) work without implementing Display
                    // — they all derive Debug, and the log surface is
                    // diagnostic-only (the over-the-wire payload uses the
                    // serde-derived JSON shape, untouched by this format).
                    log::warn!(
                        target: "ipc",
                        "[ipc] cmd={} duration_us={} payload_bytes={} ok=false err={:?}",
                        #fn_name_str, __dur_us, __payload_bytes, e
                    );
                }
            }
        }
    } else {
        quote! {
            log::info!(
                target: "ipc",
                "[ipc] cmd={} duration_us={} payload_bytes={} ok=true",
                #fn_name_str, __dur_us, __payload_bytes
            );
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
            let __payload_bytes: usize = if cfg!(debug_assertions)
                || std::env::var("MDR_IPC_TRACE").is_ok()
            {
                0
            } else {
                0
            };
            #log_call
            __result
        }
    };

    let expanded = quote! {
        #(#attrs)*
        #tauri_cmd_attr
        #[specta::specta]
        #vis #sig #wrapped_body
    };

    TokenStream::from(expanded)
}
