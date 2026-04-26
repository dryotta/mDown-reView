import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { resolveHtmlAssets, openExternalUrl } from "@/lib/tauri-commands";
import { dirname, resolveWorkspacePath } from "@/lib/path-utils";
import { EXTERNAL_LINK_SCHEME, BLOCKED_LINK_SCHEME } from "@/lib/url-policy";
import { ReadingWidthHandle } from "./ReadingWidthHandle";
import { useStore } from "@/store";
import { useZoom } from "@/hooks/useZoom";
import { warn } from "@/logger";
import { useCommentActions } from "@/lib/vm/use-comment-actions";
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
  const [unsafeMode, setUnsafeMode] = useState(false);
  const [commentMode, setCommentMode] = useState(false);
  const [resolvedContent, setResolvedContent] = useState(content);
  const [resolving, setResolving] = useState(false);
  const [composer, setComposer] = useState<Composer | null>(null);
  const readingContainerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const readingWidth = useStore((s) => s.readingWidth);
  const workspaceRoot = useStore((s) => s.root) ?? "";
  const { zoom } = useZoom(".html");
  const baseDir = filePath ? dirname(filePath) : undefined;
  const { addComment } = useCommentActions();

  // Per-mount nonce — regenerated on every mount, never logged or persisted.
  // crypto.randomUUID is available in Tauri's webview and modern jsdom.
  const nonce = useMemo(() => globalThis.crypto.randomUUID(), []);

  // Sandbox semantics:
  //   • safe (default):       allow-same-origin only — CSS/fonts but no JS.
  //   • unsafe (toggle):      allow-scripts only — sandboxed scripts run,
  //                            iframe is cross-origin (opaque), no parent access.
  //   • comment mode:         allow-scripts only — required for the bridge IIFE.
  //                            We never combine allow-scripts + allow-same-origin.
  // Comment mode implies scripts (the bridge needs them); document this in the UI.
  const sandbox = (unsafeMode || commentMode) ? "allow-scripts" : "allow-same-origin";

  const srcDoc = useMemo(() => {
    if (!commentMode) return resolvedContent;
    return buildBridgeSrcDoc(resolvedContent, { nonce });
  }, [resolvedContent, commentMode, nonce]);

  useEffect(() => {
    if (!filePath) {
      setResolvedContent(content); // eslint-disable-line react-hooks/set-state-in-effect
      setResolving(false);
      return;
    }
    let cancelled = false;
    setResolving(true);
    resolveHtmlAssets(content, dirname(filePath))
      .then((resolved) => {
        if (!cancelled) setResolvedContent(resolved);
      })
      .catch(() => {
        if (!cancelled) setResolvedContent(content);
      })
      .finally(() => {
        if (!cancelled) setResolving(false);
      });
    return () => { cancelled = true; };
  }, [content, filePath]);

  // Bridge listener. Filter strictly by source-window AND nonce — drop anything
  // else. Translates iframe-local clientX/Y to wrapper-local coords.
  useEffect(() => {
    if (!commentMode) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional reset when toggling off
      setComposer(null);
      return;
    }
    const handler = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      if (!isBridgeMsg(event.data)) return;
      if (event.data.nonce !== nonce) return;
      const msg = event.data;
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
  }, [commentMode, nonce]);

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
          aria-label={unsafeMode ? "Disable scripts" : "Enable scripts"}
          onClick={() => setUnsafeMode(!unsafeMode)}
          style={{ marginLeft: 8 }}
        >
          {unsafeMode ? "Disable scripts" : "Enable scripts"}
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
          💬 Comment
        </button>
        {(unsafeMode || commentMode) && (
          <span style={{ marginLeft: 8, fontStyle: "italic" }}>
            {commentMode
              ? "Comment mode runs scripts in the iframe (sandboxed). Link routing disabled."
              : "Link routing disabled in scripts-enabled mode (cross-origin sandbox)."}
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
            ref={iframeRef}
            srcDoc={srcDoc}
            sandbox={sandbox}
            title="HTML preview"
            data-comment-mode={commentMode || undefined}
            style={{ width: "100%", border: "none", minHeight: 400, flex: 1, background: "white" }}
            onLoad={() => {
              // In script-enabled modes the iframe is cross-origin and we
              // cannot reach contentDocument; link routing is unavailable.
              if (unsafeMode || commentMode) return;
              const doc = iframeRef.current?.contentDocument;
              if (!doc) return;
              doc.addEventListener("click", (event) => {
                const target = event.target as Element | null;
                const anchor = target?.closest?.("a") as HTMLAnchorElement | null;
                if (!anchor) return;
                const href = anchor.getAttribute("href");
                if (!href) return;
                if (href.startsWith("#")) return;
                if (BLOCKED_LINK_SCHEME.test(href)) {
                  event.preventDefault();
                  warn(`HtmlPreviewView: blocked iframe link scheme: ${href}`);
                  return;
                }
                if (EXTERNAL_LINK_SCHEME.test(href)) {
                  event.preventDefault();
                  openExternalUrl(href).catch(() => {});
                  return;
                }
                event.preventDefault();
                if (!baseDir) return;
                const resolved = resolveWorkspacePath(workspaceRoot, baseDir, href);
                if (!resolved) {
                  warn(`HtmlPreviewView: dropped iframe link outside workspace: ${href}`);
                  return;
                }
                useStore.getState().openFile(resolved.path);
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
