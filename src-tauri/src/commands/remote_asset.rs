//! `fetch_remote_asset`: bounded HTTPS image fetcher exposed to the webview.
//!
//! The webview cannot reach `http(s)://` directly without widening the CSP.
//! Instead, the renderer asks Rust to fetch a remote image, and Rust hands
//! back a single binary blob. The frontend converts the bytes into a
//! `blob:` URL — `connect-src`/`img-src` stay locked to the local set.
//!
//! Wire format (binary IPC via `tauri::ipc::Response`, no JSON-array bloat):
//!   `[u32 BE: ct_len][ct_bytes (UTF-8 mime)][payload bytes]`
//!
//! Bounds (all enforced; violation returns an error string):
//!   1. URL must parse and have scheme `https`.
//!   2. Connect timeout 10 s, read timeout 10 s.
//!   3. Body cap: 8 MB (streamed; aborts on overflow).
//!   4. Content-type allowlist: image/png, image/jpeg, image/gif, image/webp,
//!      image/svg+xml, image/avif.
//!   5. Status must be 200.
//!   6. Redirect policy: at most 5 hops, every redirect target must be `https`.
//!   7. Concurrency cap: at most 4 in-flight fetches process-wide.

use std::sync::OnceLock;
use std::time::Duration;
use tokio::sync::Semaphore;

const MAX_BODY_BYTES: usize = 8 * 1024 * 1024;
const TIMEOUT: Duration = Duration::from_secs(10);
const MAX_REDIRECTS: usize = 5;
const MAX_CONCURRENT_FETCHES: usize = 4;
const ALLOWED_CONTENT_TYPES: &[&str] = &[
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
    "image/svg+xml",
    "image/avif",
];

#[derive(Clone, Debug)]
pub struct RemoteAssetResponse {
    pub bytes: Vec<u8>,
    pub content_type: String,
}

/// Lazily-initialised shared client. Cheap to clone; reuses the connection
/// pool across all `fetch_remote_asset` invocations. Carries the redirect
/// policy (bound 6).
fn client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        let policy = reqwest::redirect::Policy::custom(|attempt| {
            // `previous()` excludes the URL being attempted; the inequality
            // bound matches "no more than MAX_REDIRECTS hops".
            if attempt.previous().len() >= MAX_REDIRECTS {
                attempt.error("too many redirects (max 5)")
            } else if attempt.url().scheme() != "https" {
                attempt.error("redirect target scheme not https")
            } else {
                attempt.follow()
            }
        });
        reqwest::Client::builder()
            .connect_timeout(TIMEOUT)
            .timeout(TIMEOUT)
            .pool_max_idle_per_host(4)
            .redirect(policy)
            .build()
            .expect("reqwest client init")
    })
}

/// Process-wide cap on simultaneous outbound fetches (bound 7). Avoids
/// runaway parallelism if a single doc references many remote images.
fn semaphore() -> &'static Semaphore {
    static SEM: OnceLock<Semaphore> = OnceLock::new();
    SEM.get_or_init(|| Semaphore::new(MAX_CONCURRENT_FETCHES))
}

/// Pack the inner result into the wire format described in the module-level
/// doc comment. Kept tiny so frontend parsing stays a 4-line `DataView` read.
fn encode(resp: &RemoteAssetResponse) -> Vec<u8> {
    let ct = resp.content_type.as_bytes();
    let ct_len = ct.len() as u32;
    let mut buf = Vec::with_capacity(4 + ct.len() + resp.bytes.len());
    buf.extend_from_slice(&ct_len.to_be_bytes());
    buf.extend_from_slice(ct);
    buf.extend_from_slice(&resp.bytes);
    buf
}

#[tauri::command]
pub async fn fetch_remote_asset(url: String) -> Result<tauri::ipc::Response, String> {
    let resp = fetch_validated(url).await?;
    Ok(tauri::ipc::Response::new(encode(&resp)))
}

/// Bound 1 (scheme check) + delegate to `fetch_with_url`. Split out so tests
/// can exercise this exact pipeline.
async fn fetch_validated(url: String) -> Result<RemoteAssetResponse, String> {
    let parsed = url::Url::parse(&url).map_err(|e| format!("invalid url: {e}"))?;
    if parsed.scheme() != "https" {
        return Err(format!("scheme not allowed: {}", parsed.scheme()));
    }
    fetch_with_url(parsed).await
}

/// All post-scheme bounds (2-5, 6 via the shared client, 7 via the
/// semaphore). Tests bind wiremock at http:// and call this directly so the
/// production code path is exercised.
async fn fetch_with_url(url: url::Url) -> Result<RemoteAssetResponse, String> {
    let _permit = semaphore()
        .acquire()
        .await
        .map_err(|e| format!("semaphore: {e}"))?;

    // Bounds 2 (timeouts) + 6 (redirects) come from the shared client.
    let mut response = client()
        .get(url)
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;

    // Bound 5: status check.
    if response.status().as_u16() != 200 {
        return Err(format!("non-200 status: {}", response.status().as_u16()));
    }

    // Bound 4: content-type allowlist. Strip parameters (e.g. "; charset=…").
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| "missing content-type".to_string())?
        .to_string();
    let mime = content_type
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    if !ALLOWED_CONTENT_TYPES.contains(&mime.as_str()) {
        return Err(format!("content-type not allowed: {mime}"));
    }

    // Bound 3: streamed body cap. Abort on overflow. `chunk()` is reqwest's
    // built-in chunked-read API — keeps us off `futures-util`.
    let mut bytes: Vec<u8> = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| format!("stream error: {e}"))?
    {
        if bytes.len() + chunk.len() > MAX_BODY_BYTES {
            return Err(format!("response exceeds {MAX_BODY_BYTES} byte cap"));
        }
        bytes.extend_from_slice(&chunk);
    }

    Ok(RemoteAssetResponse {
        bytes,
        content_type: mime,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    // NOTE: a connect-timeout test is intentionally omitted — reliably
    // simulating connect-stage hangs cross-platform is brittle.

    #[tokio::test]
    async fn rejects_non_https_url() {
        for url in [
            "http://example.com/x.png",
            "file:///etc/passwd",
            "javascript:alert(1)",
            "data:image/png;base64,AAAA",
        ] {
            let err = fetch_validated(url.to_string()).await.expect_err(url);
            assert!(
                err.contains("scheme not allowed") || err.contains("invalid url"),
                "unexpected error for {url}: {err}"
            );
        }
    }

    #[tokio::test]
    async fn rejects_invalid_url() {
        let err = fetch_validated("not a url".into()).await.unwrap_err();
        assert!(err.contains("invalid url"), "got: {err}");
    }

    fn server_url(server: &MockServer, p: &str) -> url::Url {
        url::Url::parse(&format!("{}{}", server.uri(), p)).unwrap()
    }

    #[tokio::test]
    async fn accepts_valid_png_returns_bytes() {
        let server = MockServer::start().await;
        let png_bytes = vec![0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
        Mock::given(method("GET"))
            .and(path("/img.png"))
            .respond_with(
                ResponseTemplate::new(200)
                    .insert_header("content-type", "image/png")
                    .set_body_bytes(png_bytes.clone()),
            )
            .mount(&server)
            .await;

        let resp = fetch_with_url(server_url(&server, "/img.png"))
            .await
            .unwrap();
        assert_eq!(resp.bytes, png_bytes);
        assert_eq!(resp.content_type, "image/png");
    }

    #[tokio::test]
    async fn accepts_content_type_with_charset() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/x.svg"))
            .respond_with(
                ResponseTemplate::new(200)
                    .insert_header("content-type", "image/svg+xml; charset=utf-8")
                    .set_body_bytes(b"<svg/>".to_vec()),
            )
            .mount(&server)
            .await;
        let resp = fetch_with_url(server_url(&server, "/x.svg")).await.unwrap();
        assert_eq!(resp.content_type, "image/svg+xml");
    }

    #[tokio::test]
    async fn rejects_html_content_type() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/page"))
            .respond_with(
                ResponseTemplate::new(200)
                    .insert_header("content-type", "text/html")
                    .set_body_bytes(b"<html/>".to_vec()),
            )
            .mount(&server)
            .await;
        let err = fetch_with_url(server_url(&server, "/page"))
            .await
            .unwrap_err();
        assert!(err.contains("content-type not allowed"), "got: {err}");
    }

    #[tokio::test]
    async fn rejects_oversize_response() {
        let server = MockServer::start().await;
        let big = vec![0u8; 9 * 1024 * 1024];
        Mock::given(method("GET"))
            .and(path("/big.png"))
            .respond_with(
                ResponseTemplate::new(200)
                    .insert_header("content-type", "image/png")
                    .set_body_bytes(big),
            )
            .mount(&server)
            .await;
        let err = fetch_with_url(server_url(&server, "/big.png"))
            .await
            .unwrap_err();
        assert!(err.contains("byte cap"), "got: {err}");
    }

    #[tokio::test]
    async fn rejects_404_status() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/missing.png"))
            .respond_with(ResponseTemplate::new(404))
            .mount(&server)
            .await;
        let err = fetch_with_url(server_url(&server, "/missing.png"))
            .await
            .unwrap_err();
        assert!(err.contains("non-200"), "got: {err}");
    }

    #[tokio::test]
    async fn rejects_redirect_to_http() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/start"))
            .respond_with(
                ResponseTemplate::new(302)
                    .insert_header("location", "http://example.invalid/foo.png"),
            )
            .mount(&server)
            .await;
        let err = fetch_with_url(server_url(&server, "/start"))
            .await
            .unwrap_err();
        // reqwest surfaces the policy error inside the request-failure string.
        assert!(
            err.contains("redirect") || err.contains("scheme"),
            "got: {err}"
        );
    }

    #[tokio::test]
    async fn rejects_redirect_chain_too_long() {
        let server = MockServer::start().await;
        // 7 hops: /r0 -> /r1 -> ... -> /r6 (which would be the 7th hop).
        for i in 0..7u32 {
            let next = format!("{}/r{}", server.uri(), i + 1);
            Mock::given(method("GET"))
                .and(path(format!("/r{i}")))
                .respond_with(ResponseTemplate::new(302).insert_header("location", next.as_str()))
                .mount(&server)
                .await;
        }
        let err = fetch_with_url(server_url(&server, "/r0"))
            .await
            .unwrap_err();
        assert!(
            err.contains("redirect") || err.contains("too many"),
            "got: {err}"
        );
    }
}
