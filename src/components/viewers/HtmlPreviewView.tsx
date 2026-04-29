import { useState, useEffect, useRef, useCallback } from "react";
import {
  resolveHtmlAssets,
  openExternalUrl,
  getFileViewerPref,
  setFileViewerPref,
} from "@/lib/tauri-commands";
import { dirname } from "@/lib/path-utils";
import { routeLinkClick } from "@/lib/url-policy";
import { rewriteRemoteImages } from "@/lib/html-image-rewrite";
import { injectAnchorTitles } from "@/lib/html-anchor-titles";
import { useStore } from "@/store";
import { useZoom } from "@/hooks/useZoom";
import { warn } from "@/logger";
import "@/styles/html-preview.css";
import "@/styles/viewer-banner.css";

interface Props {
  content: string;
  filePath?: string;
}

export function HtmlPreviewView({ content, filePath }: Props) {
  const [allowImages, setAllowImages] = useState(false);
  const [resolvedBase, setResolvedBase] = useState(content);
  const [resolvedContent, setResolvedContent] = useState(content);
  const [resolving, setResolving] = useState(false);
  const readingContainerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const revokeImagesRef = useRef<(() => void) | null>(null);
  const workspaceRoot = useStore((s) => s.root) ?? "";
  const { zoom } = useZoom(".html");
  const baseDir = filePath ? dirname(filePath) : undefined;

  // Hard-locked sandbox — allow-same-origin only (security.md rule 12a).
  const sandbox = "allow-same-origin";

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
    return () => {
      cancelled = true;
    };
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

  // Effect 1 — local-asset resolution + anchor-title injection. Title
  // stamping runs over the asset-resolved HTML so any rewritten `href`s
  // already reflect their final shape, and lives in this effect (rather
  // than in the resolveHtmlAssets Rust path) because it depends on the
  // window-side workspaceRoot.
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
        const titled = injectAnchorTitles(resolved, {
          baseDir: dirname(filePath),
          workspaceRoot,
        });
        setResolvedBase(titled);
      })
      .catch(() => {
        if (!cancelled) setResolvedBase(content);
      })
      .finally(() => {
        if (!cancelled) setResolving(false);
      });
    return () => {
      cancelled = true;
    };
  }, [content, filePath, workspaceRoot]);

  // Effect 2 — remote-image rewrite over the cached resolved-base HTML.
  useEffect(() => {
    let cancelled = false;
    const revokePrior = revokeImagesRef.current;
    revokeImagesRef.current = null;
    if (allowImages) {
      rewriteRemoteImages(resolvedBase)
        .then(({ html, revoke }) => {
          if (cancelled) {
            revoke();
            return;
          }
          revokeImagesRef.current = revoke;
          setResolvedContent(html);
        })
        .catch(() => {
          if (!cancelled) setResolvedContent(resolvedBase);
        })
        .finally(() => {
          if (revokePrior) revokePrior();
        });
    } else {
      setResolvedContent(resolvedBase); // eslint-disable-line react-hooks/set-state-in-effect
      if (revokePrior) revokePrior();
    }
    return () => {
      cancelled = true;
    };
  }, [resolvedBase, allowImages]);

  // Cleanup blob URLs on unmount.
  useEffect(() => {
    return () => {
      const revoke = revokeImagesRef.current;
      if (revoke) revoke();
      revokeImagesRef.current = null;
    };
  }, []);

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
      </div>
      <div className="html-preview-body" ref={readingContainerRef}>
        <div ref={wrapperRef} className="html-preview-wrapper">
          <iframe
            ref={iframeRef}
            srcDoc={resolvedContent}
            sandbox={sandbox}
            title="HTML preview"
            className="html-preview-iframe"
            style={{ background: "white" }}
            onLoad={() => {
              const scrollIframeToFragment = (doc: Document, fragment: string) => {
                let id = fragment;
                try { id = decodeURIComponent(fragment); } catch { /* keep raw */ }
                const el = doc.getElementById(id);
                el?.scrollIntoView({ behavior: "smooth", block: "start" });
              };
              const installClickHandler = (doc: Document) => {
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
                      void warn(
                        `HtmlPreviewView: blocked iframe link (${route.reason}): ${route.href}`
                      );
                      return;
                    case "external":
                      event.preventDefault();
                      openExternalUrl(route.href).catch((e) =>
                        warn(`[HtmlPreviewView] link open failed: ${e}`)
                      );
                      return;
                    case "workspace":
                      event.preventDefault();
                      if (filePath && route.path === filePath) {
                        // Same-file link — scroll inside this iframe; openFile
                        // would be a no-op and `srcDoc` doesn't navigate to a
                        // sub-URL, so we have to do the scroll ourselves.
                        if (route.fragment) scrollIframeToFragment(doc, route.fragment);
                      } else {
                        if (route.fragment) {
                          useStore.getState().setPendingFragment({
                            path: route.path,
                            fragment: route.fragment,
                          });
                        }
                        useStore.getState().openFile(route.path);
                      }
                      return;
                  }
                });
              };
              const consumePendingForThisFile = (doc: Document) => {
                if (!filePath) return;
                const fragment = useStore.getState().consumePendingFragment(filePath);
                if (fragment) scrollIframeToFragment(doc, fragment);
              };
              const doc = iframeRef.current?.contentDocument;
              if (doc) {
                installClickHandler(doc);
                consumePendingForThisFile(doc);
                return;
              }
              // Bounded retry — contentDocument can be null when the load
              // event fires before the document is fully committed (observed
              // in some Chromium builds with srcdoc). One rAF is enough.
              requestAnimationFrame(() => {
                const retryDoc = iframeRef.current?.contentDocument;
                if (retryDoc) {
                  installClickHandler(retryDoc);
                  consumePendingForThisFile(retryDoc);
                } else {
                  void warn("[HtmlPreviewView] contentDocument unavailable after rAF retry");
                }
              });
            }}
          />
        </div>
      </div>
    </div>
  );
}
