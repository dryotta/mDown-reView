//! IPC shim over [`crate::core::word_tokens`]. Frontend calls
//! `invoke('tokenize_words', { text })` and gets back a `Vec<WordSpan>`
//! that lines up byte-for-byte with the Rust matcher's view.

use crate::core::word_tokens::{tokenize_words as core_tokenize, WordSpan};

#[tauri::command]
pub fn tokenize_words(text: String) -> Vec<WordSpan> {
    core_tokenize(&text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ipc_shim_returns_core_result() {
        let v = tokenize_words("hello world".to_string());
        assert_eq!(v.len(), 2);
        assert_eq!(v[0].text, "hello");
        assert_eq!(v[1].text, "world");
    }
}
