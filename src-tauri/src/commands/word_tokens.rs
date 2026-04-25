//! IPC shim over [`crate::core::word_tokens`]. Frontend calls
//! `invoke('tokenize_words', { text })` and gets back a `Vec<WordSpan>`
//! that lines up byte-for-byte with the Rust matcher's view.
//!
//! Inputs are bounded to `MAX_BYTES` (64 KiB) — the matcher only ever
//! tokenises a single line of text, and 64 KiB is well above any
//! human-readable line length. Over-cap inputs reject with a typed
//! `Err(String)` rather than burning CPU on adversarial payloads.

use crate::core::word_tokens::{tokenize_words as core_tokenize, WordSpan};

const MAX_BYTES: usize = 65_536;

#[tauri::command]
pub fn tokenize_words(text: String) -> Result<Vec<WordSpan>, String> {
    if text.len() > MAX_BYTES {
        return Err(format!(
            "tokenize_words: input exceeds {} bytes",
            MAX_BYTES
        ));
    }
    Ok(core_tokenize(&text))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ipc_shim_returns_core_result() {
        let v = tokenize_words("hello world".to_string()).unwrap();
        assert_eq!(v.len(), 2);
        assert_eq!(v[0].text, "hello");
        assert_eq!(v[1].text, "world");
    }

    #[test]
    fn returns_error_for_over_cap_input() {
        let oversized = "x".repeat(MAX_BYTES + 1);
        let res = tokenize_words(oversized);
        assert!(res.is_err(), "expected Err for input > {MAX_BYTES} bytes");
        let err = res.unwrap_err();
        assert!(err.contains("exceeds"), "unexpected error: {err}");
    }

    #[test]
    fn accepts_input_at_cap() {
        // ~60 KB of realistic word content — well under the 64 KiB cap
        // and yields a non-empty tokenization.
        let text = "hello ".repeat(10_000);
        let res = tokenize_words(text);
        assert!(res.is_ok(), "expected Ok for sub-cap input");
        let spans = res.unwrap();
        assert!(!spans.is_empty(), "expected non-empty tokenization");
    }
}
