import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import type { RefObject } from "react";
import {
  resolveHtmlAssets,
  getFileViewerPref,
  setFileViewerPref,
} from "@/lib/tauri-commands";
import { dirname } from "@/lib/path-utils";
import { rewriteRemoteImages } from "@/lib/html-image-rewrite";
import { injectAnchorTitles } from "@/lib/html-anchor-titles";
import { useStore } from "@/store";
import { useZoom } from "@/hooks/useZoom";
import { useCtrlWheelZoom } from "@/hooks/useCtrlWheelZoom";
import { useLinkRouter } from "@/hooks/useLinkRouter";
import { warn } from "@/logger";
import { ViewerBanner, selectBannerVariant } from "./ViewerBanner";
import "@/styles/html-preview.css";
import "@/styles/viewer-banner.css";

interface Props {
  content: string;
  filePath?: string;
}

// Heuristic detectors for content the sandbox / CSP will block. Used to
// suppress the warning banner on benign HTML and to make the banner text
// contextual when the content does have something blockable. The regexes
// are intentionally permissive (they may match inside comments or strings)
// — the banner is informational only, the actual blocking is done by the
// iframe sandbox + CSP.
const SCRIPT_RE = /<script\b/i;
const EXTERNAL_IMG_RE = /<img\b[^>]*\bsrc\s*=\s*["']?https?:\/\//i;

// Run `fn` against the iframe's `contentDocument` exactly once — synchronously
// if the document is already committed, otherwise after one rAF (covers a
// WebView2 timing window where `contentDocument` can be null at the very
// instant `load` fires for `srcdoc` content). Returns a cleanup that cancels
// the pending rAF; safe to call from `useEffect`. `onMissing` fires only on
// the rAF path when the retry still finds no document.
function withIframeDoc(
  iframeRef: RefObject<HTMLIFrameElement | null>,
  fn: (doc: Document) => void,
  onMissing?: () => void,
): () => void {
  const doc = iframeRef.current?.contentDocument;
  if (doc) {
    fn(doc);
    return () => {};
  }
  const raf = requestAnimationFrame(() => {
    const retry = iframeRef.current?.contentDocument;
    if (retry) fn(retry);
    else onMissing?.();
  });
  return () => cancelAnimationFrame(raf);
}

export function HtmlPreviewView({ content, filePath }: Props) {
  const [allowImages, setAllowImages] = useState(false);
  const [resolvedBase, setResolvedBase] = useState(content);
  const [resolvedContent, setResolvedContent] = useState(content);
  const [resolving, setResolving] = useState(false);
  // Bumped on each iframe `onLoad` so the Ctrl+wheel listener re-attaches
  // to the freshly-mounted contentDocument (srcdoc replaces the document
  // wholesale, breaking any prior reference).
  const [iframeDocEpoch, setIframeDocEpoch] = useState(0);
  const readingContainerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const revokeImagesRef = useRef<(() => void) | null>(null);
  const workspaceRoot = useStore((s) => s.root) ?? "";
  const { zoom, zoomIn, zoomOut } = useZoom(".html");
  const dispatchLink = useLinkRouter();

  // ── Issue #338 / AC10 — single ViewerBanner mount (tier-3 / tier-2 /
  // external-image precedence). Iter 2 lands the banner shape with
  // zero counts; tier-3/tier-2 reference scanning is deliberate
  // follow-up scope. The banner returns null when all counts are zero.
  const allowOutsideForThisTab = useStore((s) =>
    filePath ? s.allowOutsideWorkspace.has(filePath) : false
  );
  const allowExternalImagesForThisTab = useStore((s) =>
    filePath ? s.allowedRemoteImageDocs[filePath] === true : false
  );
  const bannerVariant = useMemo(
    () =>
      selectBannerVariant({
        tier3Count: 0,
        tier2Count: 0,
        externalImageCount: 0,
        allowOutsideForThisTab,
        allowExternalImagesForThisTab,
        tabPath: filePath ?? null,
      }),
    [allowOutsideForThisTab, allowExternalImagesForThisTab, filePath]
  );

  // Hard-locked sandbox — allow-same-origin only (security.md rule 12a).
  const sandbox = "allow-same-origin";

  // Detect blockable content once per `content` change so the banner is
  // suppressed entirely on benign HTML and the banner copy can be
  // contextual when something *is* blocked.
  const hasScript = useMemo(() => SCRIPT_RE.test(content), [content]);
  const hasExternalImages = useMemo(() => EXTERNAL_IMG_RE.test(content), [content]);
  const showBanner = hasScript || hasExternalImages;

  // Ctrl+wheel inside the iframe content does not bubble to the parent
  // frame, so attach the listener directly to the iframe's contentDocument.
  // The hook re-runs on `iframeDocEpoch` change (each `srcdoc` reload) and
  // forwards to the same `useZoom(".html")` controller the toolbar drives.
  useCtrlWheelZoom(iframeRef, zoomIn, zoomOut, {
    targetGetter: () => iframeRef.current?.contentDocument,
    epoch: iframeDocEpoch,
  });

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

  // Apply zoom to the iframe's document root via CSS `zoom`. CSS does not
  // cross the iframe boundary so the wrapper's font-size has no effect on
  // srcDoc content; we set the property directly on the iframe's own
  // `documentElement`. Re-runs whenever:
  //   • the zoom factor changes (toolbar +/-/reset, Ctrl+wheel inside iframe)
  //   • a fresh srcDoc is committed (`iframeDocEpoch` bump on each `onLoad`)
  // CSS `zoom` is the same property the browser's own zoom uses; it scales
  // text, images, and px-units consistently inside the iframe document.
  // The numeric `zoom` is clamped to [ZOOM_MIN, ZOOM_MAX] in the store
  // (`viewerPrefs.ts`), so the stringified value is always a finite number
  // — no CSS-injection vector via the template literal.
  useEffect(() => {
    return withIframeDoc(iframeRef, (doc) => {
      doc.documentElement.style.setProperty("zoom", String(zoom));
    });
  }, [zoom, iframeDocEpoch]);

  return (
    <div className="html-preview" data-zoom={zoom}>
      <ViewerBanner variant={bannerVariant} />
      {showBanner && (
        <div className="viewer-info-banner" role="status">
          {hasScript && hasExternalImages && (
            <span>⚠ Scripts blocked by sandbox · external images disabled</span>
          )}
          {hasScript && !hasExternalImages && (
            <span>⚠ Scripts blocked by sandbox</span>
          )}
          {!hasScript && hasExternalImages && (
            <span>
              {allowImages
                ? "ℹ External images loaded via proxy"
                : "ℹ External images disabled"}
            </span>
          )}
          {resolving && <span className="viewer-info-banner-note">⏳ Resolving local images…</span>}
          {hasExternalImages && (
            <button
              className="comment-btn"
              type="button"
              aria-pressed={allowImages}
              aria-label={allowImages ? "Disallow external images" : "Allow external images"}
              onClick={handleToggleImages}
            >
              {allowImages ? "Disallow external images" : "Allow external images"}
            </button>
          )}
        </div>
      )}
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
              setIframeDocEpoch((n) => n + 1);
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
                  // Per-AC6 — every link click goes through the single
                  // `useLinkRouter` dispatcher. The hook handles fragment
                  // scrolling (using the iframe doc when supplied),
                  // external-scheme dispatch, workspace-relative
                  // navigation, and tier-3 fail-closed blocking.
                  event.preventDefault();
                  void dispatchLink(href, { filePath: filePath ?? null, iframeDoc: doc });
                });
              };
              const consumePendingForThisFile = (doc: Document) => {
                if (!filePath) return;
                const fragment = useStore.getState().consumePendingFragment(filePath);
                if (fragment) scrollIframeToFragment(doc, fragment);
              };
              withIframeDoc(
                iframeRef,
                (doc) => {
                  installClickHandler(doc);
                  consumePendingForThisFile(doc);
                },
                () => void warn("[HtmlPreviewView] contentDocument unavailable after rAF retry"),
              );
            }}
          />
        </div>
      </div>
    </div>
  );
}
