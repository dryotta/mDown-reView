import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { resolveHtmlAssets, openExternalUrl, getFileViewerPref, setFileViewerPref } from "@/lib/tauri-commands";
import { dirname } from "@/lib/path-utils";
import { routeLinkClick } from "@/lib/url-policy";
import { rewriteRemoteImages } from "@/lib/html-image-rewrite";
import { ReadingWidthHandle } from "./ReadingWidthHandle";
import { useStore } from "@/store";
import { useZoom } from "@/hooks/useZoom";
import { warn, info } from "@/logger";
import { buildBridgeSrcDoc, isBridgeMsg } from "@/lib/html-bridge";
import "@/styles/html-preview.css";
import "@/styles/viewer-banner.css";

interface Props {
  content: string;
  filePath?: string;
}

export function HtmlPreviewView({ content, filePath }: Props) {
  // Two independent toggles — see the sandbox matrix below. We never combine
  // allow-scripts + allow-same-origin (security.md rule 12a).
  const [allowImages, setAllowImages] = useState(false);
  const [allowScripts, setAllowScripts] = useState(false);
  const [resolvedBase, setResolvedBase] = useState(content);
  const [resolvedContent, setResolvedContent] = useState(content);
  const [resolving, setResolving] = useState(false);
  const readingContainerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const revokeImagesRef = useRef<(() => void) | null>(null);
  const readingWidth = useStore((s) => s.readingWidth);
  const workspaceRoot = useStore((s) => s.root) ?? "";
  const { zoom } = useZoom(".html");
  const baseDir = filePath ? dirname(filePath) : undefined;

  // Load persisted `allowImages` pref on mount (keyed by file path).
  // Only `allowImages` for HTML preview persists — `allowScripts` is session-only.
  useEffect(() => {
    if (!filePath) return;
    let cancelled = false;
    getFileViewerPref(filePath)
      .then((pref) => {
        if (!cancelled && pref?.allow_images) {
          setAllowImages(true);
        }
      })
      .catch(() => {}); // safe default (false) on any error
    return () => { cancelled = true; };
  }, [filePath]);

  // Persist callback — fire-and-forget alongside state update.
  const handleToggleImages = useCallback(() => {
    setAllowImages((prev) => {
      const next = !prev;
      if (filePath) {
        setFileViewerPref(filePath, next).catch(() => {});
      }
      return next;
    });
  }, [filePath]);

  // Per-mount nonce — regenerated on every mount, never logged or persisted.
  // crypto.randomUUID is available in Tauri's webview and modern jsdom.
  const nonce = useMemo(() => globalThis.crypto.randomUUID(), []);

  // Sandbox matrix:
  //   allowImages | allowScripts | sandbox value
  //   ------------|--------------|----------------------
  //   false       | false        | allow-same-origin (default safe)
  //   true        | false        | allow-same-origin
  //   any         | true         | allow-scripts
  // We never combine allow-scripts + allow-same-origin.
  const sandbox = allowScripts ? "allow-scripts" : "allow-same-origin";

  // When scripts mode is on, install the bridge IIFE so anchor
  // clicks come back to us via postMessage (the iframe is cross-origin in
  // that mode and we cannot reach contentDocument). Safe mode keeps the
  // raw resolved content + uses the onLoad contentDocument listener.
  const srcDoc = useMemo(() => {
    if (!allowScripts) return resolvedContent;
    return buildBridgeSrcDoc(resolvedContent, { nonce });
  }, [resolvedContent, allowScripts, nonce]);

  // Effect 1 — local-asset resolution. Keyed only on inputs that affect the
  // resolved-base HTML (path + content). The remote-image / scripts toggles
  // do NOT belong here: they don't change what `resolveHtmlAssets` returns
  // and re-running this effect on every toggle would burn an IPC round-trip
  // per click (rule 2 in `docs/performance.md`).
  useEffect(() => {
    if (!filePath) {
      setResolvedBase(content); // eslint-disable-line react-hooks/set-state-in-effect
      setResolving(false);
      return;
    }
    let cancelled = false;
    setResolving(true);
    resolveHtmlAssets(content, dirname(filePath))
      .then((resolved) => {
        if (cancelled) return;
        setResolvedBase(resolved);
      })
      .catch(() => {
        if (!cancelled) setResolvedBase(content);
      })
      .finally(() => {
        if (!cancelled) setResolving(false);
      });
    return () => { cancelled = true; };
  }, [content, filePath]);

  // Effect 2 — remote-image rewrite over the cached resolved-base HTML.
  // Owns the blob-URL revoke lifecycle so toggling allowImages off (or
  // flipping allowScripts on, which disables the rewrite path) cleans up
  // the prior batch.
  useEffect(() => {
    let cancelled = false;
    const revokePrior = revokeImagesRef.current;
    revokeImagesRef.current = null;
    if (allowImages && !allowScripts) {
      // Route http(s) <img> through the fetch_remote_asset chokepoint.
      // CSP cannot be widened (security.md rule 17), so we materialise
      // the bytes here and swap to blob: URLs.
      rewriteRemoteImages(resolvedBase)
        .then(({ html, revoke }) => {
          if (cancelled) { revoke(); return; }
          revokeImagesRef.current = revoke;
          setResolvedContent(html);
        })
        .catch(() => {
          if (!cancelled) setResolvedContent(resolvedBase);
        })
        .finally(() => {
          // Revoke the prior batch only after we have new content in place,
          // so the iframe never sees a dangling blob URL.
          if (revokePrior) revokePrior();
        });
    } else {
      setResolvedContent(resolvedBase); // eslint-disable-line react-hooks/set-state-in-effect
      if (revokePrior) revokePrior();
    }
    return () => { cancelled = true; };
  }, [resolvedBase, allowImages, allowScripts]);

  // Cleanup blob URLs on unmount.
  useEffect(() => {
    return () => {
      const revoke = revokeImagesRef.current;
      if (revoke) revoke();
      revokeImagesRef.current = null;
    };
  }, []);

  // Bridge listener — installed whenever scripts mode is on, so
  // link routing can react to bridge messages. Filter strictly by
  // source-window AND nonce — drop anything else.
  useEffect(() => {
    if (!allowScripts) return;
    const handler = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      if (!isBridgeMsg(event.data)) return;
      if (event.data.nonce !== nonce) return;
      const msg = event.data;
      if (msg.type === "link") {
        const route = routeLinkClick(msg.href, { baseDir, workspaceRoot });
        switch (route.kind) {
          case "blocked":
            warn(`HtmlPreviewView: blocked iframe link (${route.reason}): ${route.href}`);
            break;
          case "external":
            openExternalUrl(route.href).catch(() => {});
            break;
          case "fragment":
            // Best-effort placeholder — full in-iframe scroll requires
            // posting back to the bridge IIFE with the fragment id.
            info(`HtmlPreviewView: in-iframe fragment scroll not yet implemented: #${route.fragment}`);
            break;
          case "workspace":
            useStore.getState().openFile(route.path);
            break;
        }
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [allowScripts, nonce, baseDir, workspaceRoot]);

  return (
    <div className="html-preview" data-zoom={zoom} style={{ fontSize: `${zoom * 100}%` }}>
      <div className="viewer-info-banner">
        ⚠ Sandboxed preview — scripts and external resources disabled
        {resolving && <span className="viewer-info-banner-note">⏳ Resolving local images…</span>}
        <button
          className="comment-btn"
          type="button"
          aria-pressed={allowImages}
          aria-label={allowImages ? "Disallow external images" : "Allow external images"}
          onClick={handleToggleImages}
        >
          {allowImages ? "Disallow external images" : "Allow external images"}
        </button>
        <button
          className="comment-btn"
          type="button"
          aria-pressed={allowScripts}
          aria-label={allowScripts ? "Disable scripts" : "Enable scripts"}
          onClick={() => setAllowScripts((v) => !v)}
        >
          {allowScripts ? "Disable scripts" : "Enable scripts"}
          <span className="viewer-info-banner-note">(higher risk — runs sandboxed JS)</span>
        </button>
        {allowScripts && (
          <span className="viewer-info-banner-note">
            Scripts enabled — sandboxed JS runs inside the iframe.
          </span>
        )}
      </div>
      <div
        className="reading-width html-preview-reading"
        ref={readingContainerRef}
        style={{
          ["--reading-width" as string]: `${readingWidth}px`,
        }}
      >
        <div ref={wrapperRef} className="html-preview-wrapper">
          <iframe
            // Chromium does not re-evaluate the sandbox attribute on srcdoc
            // changes — keying the iframe on sandbox forces a full remount so
            // allow-scripts actually applies to the new document.
            key={sandbox}
            ref={iframeRef}
            srcDoc={srcDoc}
            sandbox={sandbox}
            title="HTML preview"
            className="html-preview-iframe"
            style={{ background: "white" }}
            onLoad={() => {
              // In script-enabled mode the iframe is cross-origin
              // and link routing is delivered via the bridge postMessage path
              // (see the message-handler effect above).
              if (allowScripts) return;
              const doc = iframeRef.current?.contentDocument;
              if (!doc) return;
              doc.addEventListener("click", (event) => {
                const target = event.target as Element | null;
                const anchor = target?.closest?.("a") as HTMLAnchorElement | null;
                if (!anchor) return;
                const href = anchor.getAttribute("href");
                if (href === null) return;
                const route = routeLinkClick(href, { baseDir, workspaceRoot });
                switch (route.kind) {
                  case "fragment":
                    return; // let the browser scroll natively
                  case "blocked":
                    event.preventDefault();
                    warn(`HtmlPreviewView: blocked iframe link (${route.reason}): ${route.href}`);
                    return;
                  case "external":
                    event.preventDefault();
                    openExternalUrl(route.href).catch(() => {});
                    return;
                  case "workspace":
                    event.preventDefault();
                    useStore.getState().openFile(route.path);
                    return;
                }
              });
            }}
          />
        </div>
        <ReadingWidthHandle containerRef={readingContainerRef} side="left" />
        <ReadingWidthHandle containerRef={readingContainerRef} side="right" />
      </div>
    </div>
  );
}
