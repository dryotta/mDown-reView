//! Integration tests for the 10 MB size pre-check chokepoint in
//! `commands::fs::{read_text_file_inner, read_binary_file_inner}`. Lives
//! out-of-tree so the inline test module does not push `commands/fs.rs`
//! over the 460-line group budget. Issue #252 group A1.

use std::io::Write;
use tempfile::NamedTempFile;

use mdown_review_lib::commands::fs::{read_binary_file_inner, read_text_file_inner};

const MAX_SIZE: usize = 10 * 1024 * 1024;

#[test]
fn at_max_size_text_succeeds() {
    let mut f = NamedTempFile::new().unwrap();
    f.write_all(&vec![b'a'; MAX_SIZE]).unwrap();
    f.flush().unwrap();
    let path = f.path().to_string_lossy().into_owned();
    let result = read_text_file_inner(path);
    assert!(result.is_ok());
    assert_eq!(result.unwrap().size_bytes, MAX_SIZE as u64);
}

#[test]
fn over_max_size_text_returns_too_large() {
    let mut f = NamedTempFile::new().unwrap();
    f.write_all(&vec![b'a'; MAX_SIZE + 1]).unwrap();
    f.flush().unwrap();
    let path = f.path().to_string_lossy().into_owned();
    let result = read_text_file_inner(path);
    assert_eq!(result.unwrap_err(), "file_too_large");
}

#[test]
fn over_max_size_binary_returns_too_large() {
    let mut f = NamedTempFile::new().unwrap();
    f.write_all(&vec![0xFFu8; MAX_SIZE + 1024]).unwrap();
    f.flush().unwrap();
    let path = f.path().to_string_lossy().into_owned();
    let result = read_binary_file_inner(path);
    assert_eq!(result.unwrap_err(), "file_too_large");
}

/// `/dev/zero` reports `metadata().len() == 0` but streams forever.
/// The `take(MAX_SIZE + 1)` cap ensures we read at most ~10 MB and the
/// post-check returns `file_too_large` rather than OOMing.
#[cfg(unix)]
#[test]
fn special_file_does_not_slurp_unbounded() {
    let result = read_text_file_inner("/dev/zero".to_string());
    assert!(result.is_err());
}
