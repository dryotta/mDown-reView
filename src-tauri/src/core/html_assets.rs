//! HTML asset resolution: inline local images as data URIs and inline local
//! stylesheets as `<style>` blocks. Mirrors the previous TS implementation in
//! `src/lib/resolve-html-assets.ts` for backward compatibility.
//!
//! Behavior:
//! - `<img src="…">` (double-quoted): if `src` is a local path, read the file,
//!   base64-encode it, and replace with a `data:<mime>;base64,…` URI.
//! - `<link rel="stylesheet" href="…">` (in either order, single or double
//!   quotes): if `href` is a local path, read the file and replace the entire
//!   tag with `<style>…</style>`.
//! - `http://`, `https://`, `data:`, and protocol-relative `//` URLs are left
//!   intact.
//! - On any per-asset error (read fails, etc.) the original tag is preserved.

use base64::Engine;
use regex::Regex;
use std::path::Path;
use std::sync::OnceLock;

/// Map of file extension (lowercase, with leading dot) to MIME type.
fn mime_for(ext: &str) -> &'static str {
    match ext {
        ".png" => "image/png",
        ".jpg" | ".jpeg" => "image/jpeg",
        ".gif" => "image/gif",
        ".svg" => "image/svg+xml",
        ".webp" => "image/webp",
        ".bmp" => "image/bmp",
        ".ico" => "image/x-icon",
        _ => "application/octet-stream",
    }
}

fn is_local_path(src: &str) -> bool {
    !src.starts_with("http://")
        && !src.starts_with("https://")
        && !src.starts_with("data:")
        && !src.starts_with("//")
}

/// Resolve `src` against `html_dir`. If `src` is already absolute (Unix-style
/// `/`, Windows backslash, or drive letter `X:`), return it unchanged.
/// Otherwise strip a leading `./` and join with `html_dir` using `/`.
fn resolve_path(src: &str, html_dir: &Path) -> String {
    if src.starts_with('/') || src.starts_with('\\') {
        return src.to_string();
    }
    // Drive letter check: e.g., "C:" at start
    let bytes = src.as_bytes();
    if bytes.len() >= 2 && bytes[1] == b':' && (bytes[0] as char).is_ascii_alphabetic() {
        return src.to_string();
    }
    let clean = src.strip_prefix("./").unwrap_or(src);
    format!("{}/{}", html_dir.to_string_lossy(), clean)
}

/// Lowercase extension (including leading `.`), or "" if none.
/// Mirrors TS extname() in path-utils.ts.
fn extname(path: &str) -> String {
    let normalized = path.replace('\\', "/");
    let base = normalized.rsplit('/').next().unwrap_or(path);
    if let Some(idx) = base.rfind('.') {
        if idx > 0 {
            return base[idx..].to_lowercase();
        }
    }
    String::new()
}

struct Replacement {
    full_len: usize,
    replacement: String,
    index: usize,
}

static IMG_RE: OnceLock<Regex> = OnceLock::new();
static LINK_REL_FIRST_RE: OnceLock<Regex> = OnceLock::new();
static LINK_HREF_FIRST_RE: OnceLock<Regex> = OnceLock::new();

fn img_re() -> &'static Regex {
    IMG_RE.get_or_init(|| Regex::new(r#"(?i)(<img\b[^>]*?\bsrc=")([^"]+)(")"#).unwrap())
}
fn link_rel_first_re() -> &'static Regex {
    LINK_REL_FIRST_RE.get_or_init(|| {
        Regex::new(
            r#"(?i)(<link\b[^>]*?\brel=["']stylesheet["'][^>]*?\bhref=["'])([^"']+)(["'][^>]*?>)"#,
        )
        .unwrap()
    })
}
fn link_href_first_re() -> &'static Regex {
    LINK_HREF_FIRST_RE.get_or_init(|| {
        Regex::new(
            r#"(?i)(<link\b[^>]*?\bhref=["'])([^"']+)(["'][^>]*?\brel=["']stylesheet["'][^>]*?>)"#,
        )
        .unwrap()
    })
}

/// Resolve `<img>` tags: inline as data URIs.
fn resolve_images(html: &str, html_dir: &Path) -> Vec<Replacement> {
    let mut out = Vec::new();
    for cap in img_re().captures_iter(html) {
        let full = cap.get(0).unwrap();
        let prefix = cap.get(1).unwrap().as_str();
        let src = cap.get(2).unwrap().as_str();
        let suffix = cap.get(3).unwrap().as_str();
        if !is_local_path(src) {
            continue;
        }
        let abs = resolve_path(src, html_dir);
        let bytes = match std::fs::read(&abs) {
            Ok(b) => b,
            Err(_) => continue, // keep original
        };
        let mime = mime_for(&extname(&abs));
        let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
        out.push(Replacement {
            full_len: full.as_str().len(),
            replacement: format!("{}data:{};base64,{}{}", prefix, mime, b64, suffix),
            index: full.start(),
        });
    }
    out
}

/// Resolve `<link rel="stylesheet" href="…">` (either ordering): inline as `<style>` blocks.
fn resolve_stylesheets(html: &str, html_dir: &Path) -> Vec<Replacement> {
    let mut out: Vec<Replacement> = Vec::new();

    let mut process = |re: &Regex| {
        for cap in re.captures_iter(html) {
            let full = cap.get(0).unwrap();
            let href = cap.get(2).unwrap().as_str();
            if !is_local_path(href) {
                continue;
            }
            // Avoid duplicates from the second (href-first) pattern matching the same tag
            if out.iter().any(|r| r.index == full.start()) {
                continue;
            }
            let abs = resolve_path(href, html_dir);
            let css = match std::fs::read_to_string(&abs) {
                Ok(s) => s,
                Err(_) => continue, // keep original
            };
            out.push(Replacement {
                full_len: full.as_str().len(),
                replacement: format!("<style>{}</style>", css),
                index: full.start(),
            });
        }
    };

    process(link_rel_first_re());
    process(link_href_first_re());
    out
}

/// Resolve all local image and stylesheet references in `html` to inlined
/// data URIs / `<style>` blocks. Per-asset failures preserve the original tag.
pub fn resolve_local_assets(html: &str, html_dir: &Path) -> String {
    let mut all = resolve_images(html, html_dir);
    all.extend(resolve_stylesheets(html, html_dir));
    // Apply from end → start so earlier indices remain valid
    all.sort_by_key(|r| std::cmp::Reverse(r.index));

    let mut result = html.to_string();
    for r in all {
        result.replace_range(r.index..r.index + r.full_len, &r.replacement);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::Engine;
    use std::fs;
    use tempfile::TempDir;

    fn write(dir: &Path, name: &str, bytes: &[u8]) {
        fs::write(dir.join(name), bytes).unwrap();
    }

    fn b64(bytes: &[u8]) -> String {
        base64::engine::general_purpose::STANDARD.encode(bytes)
    }

    #[test]
    fn replaces_relative_img_src_with_data_url() {
        let tmp = TempDir::new().unwrap();
        write(tmp.path(), "photo.png", b"PNGDATA");
        let html = r#"<img src="photo.png">"#;
        let out = resolve_local_assets(html, tmp.path());
        assert!(out.contains(&format!("data:image/png;base64,{}", b64(b"PNGDATA"))));
        assert!(!out.contains("photo.png"));
    }

    #[test]
    fn resolves_paths_relative_to_html_dir_with_dot_prefix() {
        let tmp = TempDir::new().unwrap();
        fs::create_dir(tmp.path().join("images")).unwrap();
        write(&tmp.path().join("images"), "cat.jpg", b"JPGDATA");
        let html = r#"<img src="./images/cat.jpg">"#;
        let out = resolve_local_assets(html, tmp.path());
        assert!(out.contains(&format!("data:image/jpeg;base64,{}", b64(b"JPGDATA"))));
    }

    #[test]
    fn leaves_http_urls_untouched() {
        let tmp = TempDir::new().unwrap();
        let html = r#"<img src="https://example.com/img.png">"#;
        let out = resolve_local_assets(html, tmp.path());
        assert_eq!(out, html);
    }

    #[test]
    fn leaves_data_urls_untouched() {
        let tmp = TempDir::new().unwrap();
        let html = r#"<img src="data:image/png;base64,AAAA">"#;
        let out = resolve_local_assets(html, tmp.path());
        assert_eq!(out, html);
    }

    #[test]
    fn leaves_protocol_relative_untouched() {
        let tmp = TempDir::new().unwrap();
        let html = r#"<img src="//cdn.example.com/img.png">"#;
        let out = resolve_local_assets(html, tmp.path());
        assert_eq!(out, html);
    }

    #[test]
    fn handles_multiple_images() {
        let tmp = TempDir::new().unwrap();
        write(tmp.path(), "a.png", b"AAA");
        write(tmp.path(), "b.jpg", b"BBB");
        let html = r#"<img src="a.png"><img src="b.jpg">"#;
        let out = resolve_local_assets(html, tmp.path());
        assert!(out.contains(&format!("data:image/png;base64,{}", b64(b"AAA"))));
        assert!(out.contains(&format!("data:image/jpeg;base64,{}", b64(b"BBB"))));
    }

    #[test]
    fn missing_file_keeps_original_tag() {
        let tmp = TempDir::new().unwrap();
        let html = r#"<img src="missing.png">"#;
        let out = resolve_local_assets(html, tmp.path());
        assert_eq!(out, html);
    }

    #[test]
    fn unknown_extension_uses_octet_stream() {
        let tmp = TempDir::new().unwrap();
        write(tmp.path(), "weird.xyz", b"BLOB");
        let html = r#"<img src="weird.xyz">"#;
        let out = resolve_local_assets(html, tmp.path());
        assert!(out.contains(&format!(
            "data:application/octet-stream;base64,{}",
            b64(b"BLOB")
        )));
    }

    #[test]
    fn inlines_local_stylesheet_rel_first() {
        let tmp = TempDir::new().unwrap();
        write(tmp.path(), "styles.css", b"body { color: red; }");
        let html = r#"<link rel="stylesheet" href="styles.css">"#;
        let out = resolve_local_assets(html, tmp.path());
        assert!(out.contains("<style>body { color: red; }</style>"));
        assert!(!out.contains("styles.css"));
    }

    #[test]
    fn inlines_stylesheet_with_href_before_rel() {
        let tmp = TempDir::new().unwrap();
        write(tmp.path(), "theme.css", b"a { color: blue; }");
        let html = r#"<link href="theme.css" rel="stylesheet">"#;
        let out = resolve_local_assets(html, tmp.path());
        assert!(out.contains("<style>a { color: blue; }</style>"));
    }

    #[test]
    fn leaves_remote_stylesheet_untouched() {
        let tmp = TempDir::new().unwrap();
        let html = r#"<link rel="stylesheet" href="https://cdn.example.com/style.css">"#;
        let out = resolve_local_assets(html, tmp.path());
        assert_eq!(out, html);
    }

    #[test]
    fn handles_both_images_and_stylesheets_together() {
        let tmp = TempDir::new().unwrap();
        write(tmp.path(), "style.css", b"p { margin: 0; }");
        write(tmp.path(), "photo.png", b"IMG");
        let html = r#"<link rel="stylesheet" href="style.css"><img src="photo.png">"#;
        let out = resolve_local_assets(html, tmp.path());
        assert!(out.contains("<style>p { margin: 0; }</style>"));
        assert!(out.contains(&format!("data:image/png;base64,{}", b64(b"IMG"))));
    }

    #[test]
    fn absolute_path_passthrough_no_join() {
        // We expect resolve_path to return absolute paths unchanged.
        let dir = Path::new("/some/dir");
        assert_eq!(resolve_path("/abs/path.png", dir), "/abs/path.png");
        assert_eq!(resolve_path("C:/x.png", dir), "C:/x.png");
        assert_eq!(resolve_path("C:\\x.png", dir), "C:\\x.png");
        assert_eq!(resolve_path("\\unc\\x.png", dir), "\\unc\\x.png");
    }

    #[test]
    fn missing_stylesheet_keeps_original() {
        let tmp = TempDir::new().unwrap();
        let html = r#"<link rel="stylesheet" href="missing.css">"#;
        let out = resolve_local_assets(html, tmp.path());
        assert_eq!(out, html);
    }

    #[test]
    fn case_insensitive_tag_matching() {
        let tmp = TempDir::new().unwrap();
        write(tmp.path(), "p.png", b"X");
        let html = r#"<IMG SRC="p.png">"#;
        let out = resolve_local_assets(html, tmp.path());
        assert!(out.contains(&format!("data:image/png;base64,{}", b64(b"X"))));
    }

    #[test]
    fn extra_attrs_on_img_preserved() {
        let tmp = TempDir::new().unwrap();
        write(tmp.path(), "p.png", b"Y");
        let html = r#"<img class="hero" src="p.png" alt="hi">"#;
        let out = resolve_local_assets(html, tmp.path());
        assert!(out.contains(r#"<img class="hero" src="data:image/png;base64,"#));
        assert!(out.contains(r#"" alt="hi">"#));
    }

    #[test]
    fn stylesheet_with_single_quotes() {
        let tmp = TempDir::new().unwrap();
        write(tmp.path(), "s.css", b"x{}");
        let html = r#"<link rel='stylesheet' href='s.css'>"#;
        let out = resolve_local_assets(html, tmp.path());
        assert!(out.contains("<style>x{}</style>"));
    }

    // ── Edge cases ─────────────────────────────────────────────────────────

    #[test]
    fn empty_img_src_preserves_original_tag() {
        // An empty `src` is "local" by the predicate, but reading "" fails;
        // the per-asset error path keeps the tag intact.
        let tmp = TempDir::new().unwrap();
        let html = r#"<img src="">"#;
        let out = resolve_local_assets(html, tmp.path());
        assert_eq!(out, html);
    }

    #[test]
    fn mismatched_img_quotes_not_matched() {
        // IMG_RE requires balanced double quotes. A double-quote opener with a
        // single-quote attempt-closer should never match the regex, so the
        // tag is left untouched (no read attempt, no replacement).
        let tmp = TempDir::new().unwrap();
        let html = r#"<img src="foo'>"#;
        let out = resolve_local_assets(html, tmp.path());
        assert_eq!(out, html);
    }

    #[test]
    fn img_src_with_query_and_fragment_preserved_when_no_such_file() {
        // The path resolver passes the literal value (including `?...#...`)
        // through to std::fs::read. No file by that exact name exists, so
        // the tag is preserved. This pins current behavior — callers should
        // not rely on URL-style query/fragment stripping at this layer.
        let tmp = TempDir::new().unwrap();
        // Note: a real `logo.png` exists, but the resolver looks for
        // "logo.png?v=2#anchor" verbatim, which does NOT exist.
        write(tmp.path(), "logo.png", b"PNG");
        let html = r#"<img src="logo.png?v=2#anchor">"#;
        let out = resolve_local_assets(html, tmp.path());
        assert_eq!(out, html);
    }

    #[test]
    fn single_quoted_img_src_left_untouched() {
        // IMG_RE is intentionally double-quote-only (mirrors the deleted TS
        // resolve-html-assets.ts). Single-quoted `<img>` tags should not
        // be inlined even when the referenced file exists. This pins the
        // contract; widening it is an explicit, separate change.
        let tmp = TempDir::new().unwrap();
        write(tmp.path(), "p.png", b"PNGDATA");
        let html = r#"<img src='p.png'>"#;
        let out = resolve_local_assets(html, tmp.path());
        assert_eq!(out, html);
    }
}
