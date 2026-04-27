import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { resolveHtmlAssets, openExternalUrl } from "@/lib/tauri-commands";
import { dirname } from "@/lib/path-utils";
import { routeLinkClick } from "@/lib/url-policy";
import { rewriteRemoteImages } from "@/lib/html-image-rewrite";
import { ReadingWidthHandle } from "./ReadingWidthHandle";
import { useStore } from "@/store";
import { useZoom } from "@/hooks/useZoom";
import { warn, info } from "@/logger";
import { useCommentActions } from "@/lib/vm/use-comment-actions";
import { IconComment } from "@/components/Icons";
import { CommentInput } from "@/components/comments/CommentInput";
import { buildBridgeSrcDoc, isBridgeMsg } from "@/lib/html-bridge";
import type { Anchor } from "@/types/comments";
import "@/styles/html-preview.css";

interface Props {
  content: string;
  filePath?: string;
}

interface Composer {
  anchor: Anchor;
  top: number;
  left: number;
}

export function HtmlPreviewView({ content, filePath }: Props) {
  // Two independent toggles — see the sandbox matrix below. We never combine
  // allow-scripts + allow-same-origin (security.md rule 12a).
  const [allowImages, setAllowImages] = useState(false);
  const [allowScripts, setAllowScripts] = useState(false);
  const [commentMode, setCommentMode] = useState(false);
  const [resolvedBase, setResolvedBase] = useState(content);
  const [resolvedContent, setResolvedContent] = useState(content);
  const [resolving, setResolving] = useState(false);
  const [composer, setComposer] = useState<Composer | null>(null);
  const readingContainerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const revokeImagesRef = useRef<(() => void) | null>(null);
  const readingWidth = useStore((s) => s.readingWidth);
  const workspaceRoot = useStore((s) => s.root) ?? "";
  const { zoom } = useZoom(".html");
  const baseDir = filePath ? dirname(filePath) : undefined;
  const { addComment } = useCommentActions();

  // Per-mount nonce — regenerated on every mount, never logged or persisted.
  // crypto.randomUUID is available in Tauri's webview and modern jsdom.
  const nonce = useMemo(() => globalThis.crypto.randomUUID(), []);

  // Sandbox matrix:
  //   allowImages | allowScripts | sandbox value
  //   ------------|--------------|----------------------
  //   false       | false        | allow-same-origin (default safe)
  //   true        | false        | allow-same-origin
  //   any         | true         | allow-scripts
  // Comment mode implies scripts (the bridge needs them) so it forces the
  // allow-scripts branch. We never combine allow-scripts + allow-same-origin.
  const scriptsActive = allowScripts || commentMode;
  const sandbox = scriptsActive ? "allow-scripts" : "allow-same-origin";

  // When scripts/comment mode is on, install the bridge IIFE so anchor
  // clicks come back to us via postMessage (the iframe is cross-origin in
  // that mode and we cannot reach contentDocument). Safe mode keeps the
  // raw resolved content + uses the onLoad contentDocument listener.
  const srcDoc = useMemo(() => {
    if (!scriptsActive) return resolvedContent;
    return buildBridgeSrcDoc(resolvedContent, { nonce, commentMode });
  }, [resolvedContent, scriptsActive, commentMode, nonce]);

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

  // Bridge listener — installed whenever scripts OR comment mode is on, so
  // both link routing (always) and the comment composer (commentMode only)
  // can react to bridge messages. Filter strictly by source-window AND
  // nonce — drop anything else.
  useEffect(() => {
    if (!commentMode && !scriptsActive) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional reset when toggling off
      setComposer(null);
      return;
    }
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
        return;
      }
      if (!commentMode) return;
      const wrap = wrapperRef.current;
      const iframe = iframeRef.current;
      let top = msg.clientY + 8;
      let left = msg.clientX + 8;
      if (wrap && iframe) {
        const wr = wrap.getBoundingClientRect();
        const fr = iframe.getBoundingClientRect();
        top = (fr.top - wr.top) + msg.clientY + 8;
        left = (fr.left - wr.left) + msg.clientX + 8;
      }
      const anchor: Anchor = msg.type === "selection"
        ? {
            kind: "html_range",
            selector_path: msg.selectorPath,
            start_offset: msg.startOffset,
            end_offset: msg.endOffset,
            selected_text: msg.selectedText,
          }
        : {
            kind: "html_element",
            selector_path: msg.selectorPath,
            tag: msg.tag,
            text_preview: msg.textPreview,
          };
      setComposer({ anchor, top, left });
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [commentMode, scriptsActive, nonce, baseDir, workspaceRoot]);

  const handleSaveComment = useCallback(
    (text: string) => {
      if (!composer || !filePath) {
        setComposer(null);
        return;
      }
      addComment(filePath, text, composer.anchor).catch(() => {});
      setComposer(null);
    },
    [composer, filePath, addComment],
  );

  return (
    <div className="html-preview" data-zoom={zoom} style={{ display: "flex", flexDirection: "column", height: "100%", fontSize: `${zoom * 100}%` }}>
      <div className="html-preview-banner" style={{ padding: "6px 12px", background: "var(--color-warning-bg, #fff3cd)", borderBottom: "1px solid var(--color-warning-border, #ffc107)", fontSize: 12 }}>
        ⚠ Sandboxed preview — scripts and external resources disabled
        {resolving && <span style={{ marginLeft: 8 }}>⏳ Resolving local images…</span>}
        <button
          className="comment-btn"
          type="button"
          aria-pressed={allowImages}
          aria-label={allowImages ? "Disallow external images" : "Allow external images"}
          onClick={() => setAllowImages((v) => !v)}
          style={{ marginLeft: 8 }}
        >
          {allowImages ? "Disallow external images" : "Allow external images"}
        </button>
        <button
          className="comment-btn"
          type="button"
          aria-pressed={allowScripts}
          aria-label={allowScripts ? "Disable scripts" : "Enable scripts"}
          onClick={() => setAllowScripts((v) => !v)}
          style={{ marginLeft: 8 }}
        >
          {allowScripts ? "Disable scripts" : "Enable scripts"}
          <span style={{ marginLeft: 4, opacity: 0.7 }}>(higher risk — runs sandboxed JS)</span>
        </button>
        <button
          type="button"
          aria-pressed={commentMode}
          aria-label={commentMode ? "Exit comment mode" : "Enter comment mode"}
          className={"html-preview-comment-toggle" + (commentMode ? " is-active" : "")}
          onClick={() => setCommentMode((m) => !m)}
          style={{ marginLeft: 8 }}
          disabled={!filePath}
          title={filePath ? undefined : "Save the file to enable commenting"}
        >
          <IconComment /> Comment
        </button>
        {(allowScripts || commentMode) && (
          <span style={{ marginLeft: 8, fontStyle: "italic" }}>
            {commentMode
              ? "Comment mode runs scripts in the iframe (sandboxed)."
              : "Scripts enabled — sandboxed JS runs inside the iframe."}
          </span>
        )}
      </div>
      <div
        className="reading-width"
        ref={readingContainerRef}
        style={{
          ["--reading-width" as string]: `${readingWidth}px`,
          flex: 1,
          display: "flex",
          minHeight: 0,
        }}
      >
        <div ref={wrapperRef} style={{ position: "relative", flex: 1, display: "flex", minHeight: 0 }}>
          <iframe
            // Chromium does not re-evaluate the sandbox attribute on srcdoc
            // changes — keying the iframe on sandbox forces a full remount so
            // allow-scripts actually applies to the new document.
            key={sandbox}
            ref={iframeRef}
            srcDoc={srcDoc}
            sandbox={sandbox}
            title="HTML preview"
            data-comment-mode={commentMode || undefined}
            style={{ width: "100%", border: "none", minHeight: 400, flex: 1, background: "white" }}
            onLoad={() => {
              // In script-enabled or comment modes the iframe is cross-origin
              // and link routing is delivered via the bridge postMessage path
              // (see the message-handler effect above).
              if (scriptsActive) return;
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
          {composer && (
            <div className="html-preview-overlay">
              <div
                className="html-preview-composer"
                data-testid="html-preview-composer"
                style={{ top: composer.top, left: composer.left }}
              >
                <CommentInput
                  onSave={handleSaveComment}
                  onClose={() => setComposer(null)}
                  placeholder={composer.anchor.kind === "html_range" ? "Comment on selection…" : "Comment on element…"}
                />
              </div>
            </div>
          )}
        </div>
        <ReadingWidthHandle containerRef={readingContainerRef} side="left" />
        <ReadingWidthHandle containerRef={readingContainerRef} side="right" />
      </div>
    </div>
  );
}
