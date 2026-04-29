import { fetchRemoteAsset } from "./tauri-commands";
import { warn, info } from "@/logger";

// When the HTML preview "Allow external images" toggle is on, we route every
// `<img src="http(s)://...">` through the existing `fetch_remote_asset`
// chokepoint (https-only, size/timeout-bounded, image/* allowlist) and swap
// the src to a `blob:` URL. CSP is NOT widened — the iframe still cannot
// reach the network, only the parent webview that runs this code can.
//
// Returns the rewritten HTML and a `revoke` callback the caller MUST invoke
// on unmount or content change to release the created blob URLs.

const REMOTE_IMG_RE = /<img\b([^>]*?)\bsrc\s*=\s*("https?:\/\/[^"]*"|'https?:\/\/[^']*')([^>]*)>/gi;

/**
 * Hard cap on remote `<img>` rewrites per document. Bounds the IPC fan-out
 * a single user-supplied HTML file can trigger (rule 1 in
 * `docs/performance.md` — no unbounded scan over user-supplied data).
 */
export const MAX_REMOTE_IMAGES = 100;

/**
 * Maximum concurrent `fetch_remote_asset` IPC calls in flight. Keeps the
 * proxy semaphore from being overrun by a single document and gives the
 * rest of the UI a chance to interleave.
 */
const FETCH_CONCURRENCY = 8;

export interface RewriteResult {
  html: string;
  revoke: () => void;
}

interface MatchRec {
  index: number;
  length: number;
  pre: string;
  post: string;
  url: string;
}

export async function rewriteRemoteImages(html: string): Promise<RewriteResult> {
  const created: string[] = [];
  const matches: MatchRec[] = [];
  REMOTE_IMG_RE.lastIndex = 0;
  for (let m: RegExpExecArray | null; (m = REMOTE_IMG_RE.exec(html)); ) {
    const quoted = m[2];
    const url = quoted.slice(1, -1); // Strip the surrounding quote character.
    matches.push({
      index: m.index,
      length: m[0].length,
      pre: m[1],
      post: m[3],
      url,
    });
  }
  if (matches.length === 0) {
    return { html, revoke: () => {} };
  }

  // Cap the number of remote images we'll process for a single document.
  if (matches.length > MAX_REMOTE_IMAGES) {
    void info(
      `rewriteRemoteImages: capped at ${MAX_REMOTE_IMAGES} of ${matches.length} remote <img> srcs`
    ); // fire-and-forget log
    matches.length = MAX_REMOTE_IMAGES;
  }

  // Fetch through a small fixed-size pool so we don't fan out unbounded
  // parallel IPC calls. Resolved blob URLs land in a parallel array.
  const resolved: (string | null)[] = new Array(matches.length).fill(null);
  let cursor = 0;
  const worker = async () => {
    for (;;) {
      const i = cursor++;
      if (i >= matches.length) return;
      const m = matches[i];
      try {
        const { bytes, contentType } = await fetchRemoteAsset(m.url);
        // Construct the Blob from a fresh ArrayBuffer copy — the underlying
        // buffer behind `bytes` is shared with the IPC response and may be
        // detached on some runtimes.
        const blob = new Blob([bytes.slice().buffer], {
          type: contentType || "application/octet-stream",
        });
        const blobUrl = URL.createObjectURL(blob);
        created.push(blobUrl);
        resolved[i] = blobUrl;
      } catch (e) {
        void warn(`rewriteRemoteImages: failed to fetch ${m.url}: ${String(e)}`); // fire-and-forget log
      }
    }
  };
  const workerCount = Math.min(FETCH_CONCURRENCY, matches.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  // Single-pass rebuild: the matches were collected in source order, so we
  // can splice slices of the original buffer between match boundaries
  // without re-scanning. Avoids the O(N·H) `String.replace` loop.
  const parts: string[] = [];
  let pos = 0;
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    parts.push(html.slice(pos, m.index));
    const blobUrl = resolved[i];
    if (blobUrl) {
      parts.push(`<img${m.pre}src="${blobUrl}"${m.post}>`);
    } else {
      parts.push(html.slice(m.index, m.index + m.length));
    }
    pos = m.index + m.length;
  }
  parts.push(html.slice(pos));
  const out = parts.join("");

  return {
    html: out,
    revoke: () => {
      for (const u of created) {
        try {
          URL.revokeObjectURL(u);
        } catch {
          /* noop */
        }
      }
      created.length = 0;
    },
  };
}
