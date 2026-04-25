import { useCallback, useEffect, useState } from "react";
import type { ComponentPropsWithoutRef, ComponentType } from "react";
import type { ExtraProps } from "react-markdown";
import { convertAssetUrl, fetchRemoteAsset } from "@/lib/tauri-commands";
import { dirname } from "@/lib/path-utils";
import { useStore } from "@/store";
import { warn } from "@/logger";
import { RemoteImagePlaceholder } from "./RemoteImagePlaceholder";

type ImgComponent = ComponentType<ComponentPropsWithoutRef<"img"> & ExtraProps>;

/**
 * Lazy `<img>` for a remote https URL. Fetches bytes via the bounded Rust
 * `fetch_remote_asset` command and converts them to a blob: URL so the CSP
 * `img-src` allowlist (asset:/data:/blob:/self) need not be widened. The blob
 * URL is revoked on unmount or when `url` changes.
 */
function RemoteImage({
  url,
  alt,
  ...rest
}: { url: string } & Omit<ComponentPropsWithoutRef<"img">, "src">) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let createdUrl: string | null = null;
    setFailed(false); // eslint-disable-line react-hooks/set-state-in-effect
    setBlobUrl(null);
    fetchRemoteAsset(url)
      .then((res) => {
        if (cancelled) return;
        const blob = new Blob([res.bytes as BlobPart], { type: res.contentType });
        createdUrl = URL.createObjectURL(blob);
        setBlobUrl(createdUrl);
      })
      .catch((err) => {
        if (cancelled) return;
        warn(`useImgResolver: fetchRemoteAsset failed for ${url}: ${String(err)}`);
        setFailed(true);
      });
    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [url]);

  if (failed) {
    return <RemoteImagePlaceholder url={url} reason="blocked" />;
  }
  if (!blobUrl) {
    return (
      <span
        className="remote-image-loading"
        data-remote-image-loading
        style={{
          display: "inline-block",
          padding: "4px 8px",
          fontSize: 12,
          color: "var(--color-text-secondary, #6e7781)",
        }}
      >
        🖼 loading…
      </span>
    );
  }
  return <img src={blobUrl} alt={alt ?? ""} {...rest} />;
}

/**
 * Returns a memoized `img` component for ReactMarkdown.
 *
 * Resolution rules:
 *   1. workspace-relative / absolute path → `convertAssetUrl()` (asset:// URL).
 *   2. `data:` URL → passed through unchanged.
 *   3. `https://` URL → `<RemoteImage>` if the user has opted-in for this
 *      document via `allowRemoteImagesForDoc(filePath)`; otherwise a
 *      `<RemoteImagePlaceholder reason="blocked">`.
 *   4. `http://` (or other non-https remote scheme) → always blocked with
 *      `<RemoteImagePlaceholder reason="insecure">`.
 *
 * The returned `img` reference is stable per `(filePath, allowed)` pair.
 */
export function useImgResolver(filePath: string | null): { img: ImgComponent } {
  const allowed = useStore((s) =>
    filePath ? s.allowedRemoteImageDocs[filePath] === true : false,
  );
  const img = useCallback<ImgComponent>(
    ({ src, alt, node: _node, ...props }) => {
      if (!src) return <img alt={alt ?? ""} {...props} />;

      // http:// (or other insecure remote schemes) — always blocked.
      if (/^http:\/\//i.test(src)) {
        return <RemoteImagePlaceholder url={src} reason="insecure" />;
      }

      // https:// — gated by per-doc allowance.
      if (/^https:\/\//i.test(src)) {
        if (!allowed) {
          return <RemoteImagePlaceholder url={src} reason="blocked" />;
        }
        return <RemoteImage url={src} alt={alt} {...props} />;
      }

      // data: — pass through unchanged.
      if (/^data:/i.test(src)) {
        return <img src={src} alt={alt ?? ""} {...props} />;
      }

      // Workspace-relative or absolute local path → asset:// via Rust.
      if (filePath) {
        const fileDir = dirname(filePath);
        const absolute =
          src.startsWith("/") || src.startsWith("\\") || /^[a-zA-Z]:/.test(src)
            ? src
            : `${fileDir}/${src}`;
        return <img src={convertAssetUrl(absolute)} alt={alt ?? ""} {...props} />;
      }

      return <img src={src} alt={alt ?? ""} {...props} />;
    },
    [filePath, allowed],
  );

  return { img };
}

/**
 * Returns true if `body` contains any remote (http/https) image reference —
 * either markdown `![alt](https?://…)` syntax or a raw `<img src="https?://…">`
 * tag. Used by MarkdownViewer to decide whether to surface the
 * "Allow remote images for this document" banner.
 *
 * Strips fenced code blocks (```…```) and inline code (`…`) first so a
 * documentation snippet that quotes a remote-image URL inside a code span
 * does NOT trip the banner. Pragmatic heuristic — does not parse the AST.
 */
export function hasRemoteImageReferences(body: string): boolean {
  // Order matters: strip fenced blocks before inline ticks so the inline
  // regex does not chew across a fence.
  const stripped = body
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`\n]*`/g, "");
  return (
    /!\[[^\]]*\]\(\s*https?:\/\//i.test(stripped) ||
    /<img\b[^>]*\bsrc\s*=\s*["']?https?:\/\//i.test(stripped)
  );
}
