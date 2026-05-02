import {
  Excalidraw,
  hashElementsVersion,
  getLibraryItemsHash,
} from "@excalidraw/excalidraw";
import { startTransition, useDeferredValue, useEffect, useRef, useState } from "react";

import { SkeletonLoader } from "./SkeletonLoader";

import { useTheme } from "@/hooks/useTheme";
import { extractScene, type ExcalidrawScene } from "@/lib/excalidraw/extractScene";
import { saveExcalidrawFile } from "@/lib/excalidraw/saveScene";
import {
  hasSeenFirstSave,
  markFirstSaveSeen,
} from "@/lib/excalidraw/first-save-warning";
import { useStore } from "@/store";
import { warn as logWarn, error as logError } from "@/logger";

import "@excalidraw/excalidraw/index.css";
import "@/styles/viewer-banner.css";

/**
 * Excalidraw asset path — fonts vendored into `public/excalidraw-assets/`
 * by the Vite plugin `excalidrawAssetCopy` (see `vite.config.ts`). Set at
 * module-scope so it fires once when the lazy chunk first evaluates,
 * BEFORE any `<Excalidraw>` renders. Re-running it inside the component
 * body would trigger React StrictMode's double-mount path twice, so
 * keeping it module-scope is essential. See `docs/features/excalidraw.md`.
 */
declare global {
  interface Window {
    EXCALIDRAW_ASSET_PATH?: string;
  }
}
if (typeof window !== "undefined") {
  window.EXCALIDRAW_ASSET_PATH = "/excalidraw-assets/";
}

/**
 * UIOptions frozen at module scope so object identity stays stable across
 * renders — Excalidraw's internal shallow-compare can then skip the
 * reconfigure path (same pattern as `MD_COMPONENTS` in
 * `MarkdownComponentsMap`, per design-patterns.md rule 11).
 *
 * The four explicitly-disabled `canvasActions` keys are AC4's literal spec
 * for "built-in Excalidraw Open / Save / Export are hidden":
 *   - `loadScene`         — Excalidraw's built-in "Open" picker (we own routing).
 *   - `saveAsImage`       — Excalidraw's "Save as Image" (we use Reveal in folder).
 *   - `saveToActiveFile`  — Excalidraw's built-in save (workspace-write IPC ships in iter 3).
 *   - `export`            — Excalidraw's "Export" (out of scope for the carve-out).
 *   - `toggleTheme`       — app-level theme is the source of truth.
 */
const UI_OPTIONS = {
  canvasActions: {
    loadScene: false,
    saveAsImage: false,
    saveToActiveFile: false,
    export: false,
    toggleTheme: false,
    changeViewBackgroundColor: true,
    clearCanvas: true,
  },
} as const;

interface Props {
  /** Source bytes. For `.excalidraw` / `.excalidrawlib` this is the raw JSON
   *  text. For `.excalidraw.png` / `.excalidraw.svg` it's ignored — the
   *  scene is re-fetched via `extractScene(filePath)` from the binary. */
  content: string;
  /** Canonical workspace path of the file. */
  filePath: string;
  /** Visual or Editor sub-mode (Source mode is rendered by `<SourceView/>`,
   *  not this component — see `EnhancedViewer.renderVisualView`). */
  mode: "visual" | "editor";
  /** True for `.excalidraw.png` / `.excalidraw.svg` — needs binary scene
   *  extraction. False for canonical `.excalidraw` / `.excalidrawlib`
   *  (content is already JSON text). */
  needsExtract: boolean;
}

/**
 * Custom DOM event name dispatched by Save button + Ctrl+S to ask the
 * mounted `ExcalidrawView` (which alone holds the live scene state) to
 * persist its current scene through the workspace-write IPC. Detail shape
 * is `{ path: string }` so the right view responds when multiple are
 * mounted (only one can be active at a time, but `key={path}` guarantees
 * we only mount the active one).
 */
export const EXCALIDRAW_SAVE_REQUEST = "mdownreview:excalidraw-save-request";

/**
 * Issue #352 / iter-5 BLOCKER (product F3) — friendly save-error
 * mapping. The Rust workspace-write IPC returns precise but
 * developer-flavoured error strings (e.g. `decoded payload exceeds
 * 10485760-byte cap: 12345678 bytes`). A non-engineer reading those
 * has no idea what to do. Map the documented error prefixes from
 * `src-tauri/src/commands/fs_write.rs` to user-facing copy.
 *
 * Falls through to the raw Rust message if no prefix matches — better
 * to surface a developer-debuggable string than a hand-waved generic.
 */
function friendlySaveError(rust: string): string {
  // Order: most specific prefix first.
  if (rust.includes("payload exceeds") || rust.includes("decoded payload exceeds")) {
    const m = rust.match(/(\d+) bytes?$/);
    const observed = m ? Math.round(Number(m[1]) / (1024 * 1024)) : null;
    return observed !== null
      ? `Drawing too large to save (${observed} MB > 10 MB limit). Try removing embedded images or splitting the drawing.`
      : "Drawing too large to save (over 10 MB limit). Try removing embedded images or splitting the drawing.";
  }
  if (rust.includes("path is outside an open workspace")) {
    return "This file is outside your workspace and is read-only. Open its containing folder to save.";
  }
  if (rust.includes("extension not in workspace-write allowlist")) {
    return "This file type can't be saved by mdownreview.";
  }
  if (rust.includes("invalid filename") && rust.includes("NTFS ADS")) {
    return "Filename contains a forbidden character (`:`) — rename and retry.";
  }
  if (rust.includes("invalid base64 payload")) {
    return "Failed to encode the drawing for save (corrupted scene). Reload the file and try again.";
  }
  return rust;
}

/**
 * Issue #352 / iter-7 user-reported BLOCKER (#3) — content hash for
 * accurate dirty detection. Combines Excalidraw's element-version
 * hash (which only changes when ELEMENTS change — not when
 * appState/cursor/zoom/tool changes) with the library-items hash for
 * library files. Two scenes hash equal iff their persistent content
 * is the same; tool selection, viewport pan, etc. don't shift the
 * hash. The dirty flag is now a function of "current hash !==
 * last-saved hash" rather than "any onChange has fired".
 */
function computeContentHash(
  elements: ReadonlyArray<unknown>,
  libraryItems: ReadonlyArray<unknown> | null,
): string {
  const elemHash = hashElementsVersion(elements as never);
  const libHash =
    libraryItems !== null && libraryItems.length > 0
      ? getLibraryItemsHash(libraryItems as never)
      : "";
  return `${elemHash}|${libHash}`;
}

export function ExcalidrawView({ content, filePath, mode, needsExtract }: Props) {
  const theme = useTheme();
  const excalidrawTheme: "light" | "dark" = theme === "dark" ? "dark" : "light";

  const [scene, setScene] = useState<ExcalidrawScene | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Issue #352 / iter-3 product-review fix — save failures MUST NOT
  // unmount the canvas (would discard the user's unsaved work). Track
  // save errors separately from load errors and surface them as a
  // non-modal banner above the canvas, alongside the conflict banner.
  const [saveError, setSaveError] = useState<string | null>(null);
  // Issue #352 / iter-5 BLOCKER (product F5) — first-save MRSF
  // warning. Set to `true` on the first successful save per browser
  // profile; cleared by user dismiss.
  const [showFirstSaveWarning, setShowFirstSaveWarning] = useState(false);

  // Latest scene snapshot from Excalidraw's `onChange` — captured into a
  // ref so the save handler reads the current value without re-creating
  // the listener on every keystroke. Mirrors the pattern in `useImageData`
  // for one-shot listeners with always-fresh reads.
  const liveSceneRef = useRef<ExcalidrawScene | null>(null);

  // Tab-scoped dirty + pending-conflict state. Reads from the tabs slice
  // via narrow selectors (rule 30 Warm-tier subscription discipline) so
  // unrelated tab mutations don't re-render this view.
  const dirty = useStore((s) => s.excalidrawDirtyByTab[filePath] === true);
  const externalChangePending = useStore(
    (s) => s.externalChangePendingByTab[filePath] === true,
  );
  const setExcalidrawDirty = useStore((s) => s.setExcalidrawDirty);
  const setExternalChangePending = useStore((s) => s.setExternalChangePending);

  // Issue #352 / iter-7 user-reported BLOCKER — track scene CONTENT
  // hash for accurate dirty detection. The previous "first onChange =
  // mount restore, all subsequent = user edits" approach false-fired
  // dirty when Excalidraw fired onChange for non-content reasons:
  // tool selection in the toolbar (appState.activeTool), zoom/pan,
  // theme switches, etc. The new approach captures the scene's
  // CONTENT hash on mount and compares each onChange's hash against
  // it; dirty iff the elements (or library items) actually differ.
  //
  //   - `lastSavedContentHashRef`: the hash that was on disk last
  //     time we saved (or initially loaded). Re-set on save success
  //     and on Reload.
  //   - `getCurrentHash(elements, libraryItems)`: combined element +
  //     library hash so library files also track correctly.
  const lastSavedContentHashRef = useRef<string | null>(null);
  // Issue #352 / iter-3 bug-expert review — guard against concurrent
  // saves. If the user mashes Ctrl+S, two near-simultaneous saves can
  // race and leave on-disk content with stale bytes. Atomic-write at
  // the IPC level prevents torn writes but cannot reorder saves.
  const saveInFlightRef = useRef(false);
  // Issue #352 / iter-5 BLOCKER (rubber-duck #2) — Excalidraw consumes
  // `initialData` only at mount; changing the prop later does NOT
  // rehydrate the canvas. The conflict-banner Reload button needs to
  // FORCE a remount of `<Excalidraw>` to pick up the on-disk content.
  // We bump `reloadKey` on every Reload click and use it as the React
  // `key` on the Excalidraw element AND as a dep of the load effect
  // (so binary-variant `extractScene` re-runs even when `content` is
  // the empty sentinel for `.excalidraw.png` / `.excalidraw.svg`).
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    // Reset the saved-hash baseline; the first `setScene` below will
    // populate it, and the subsequent onChange events will compare.
    lastSavedContentHashRef.current = null;

    if (needsExtract) {
      // PNG / SVG variant — Excalidraw's loadFromBlob decodes the embedded
      // scene chunk. Wrapped in startTransition so a 5MB PNG decode doesn't
      // block urgent UI updates (perf rule 12, mirrors useSourceHighlighting).
      extractScene(filePath)
        .then((extracted) => {
          if (cancelled) return;
          lastSavedContentHashRef.current = computeContentHash(
            extracted.elements,
            extracted.libraryItems ?? null,
          );
          startTransition(() => {
            setScene(extracted);
            setLoadError(null);
          });
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          const msg = err instanceof Error ? err.message : String(err);
          void logWarn(`excalidraw extractScene failed: ${msg}`);
          setLoadError(msg);
          setScene(null);
        });
    } else {
      // Canonical `.excalidraw` / `.excalidrawlib` — `content` is JSON text.
      try {
        const parsed = JSON.parse(content) as {
          type?: string;
          elements?: ReadonlyArray<unknown>;
          appState?: Record<string, unknown>;
          files?: Record<string, unknown>;
          libraryItems?: ReadonlyArray<unknown>;
        };
        // Issue #352 / iter-7 user-reported (#4) — `.excalidrawlib`
        // files have a top-level `libraryItems` array, NOT `elements`.
        // Pass them via `initialData.libraryItems` so Excalidraw shows
        // the library panel populated. Also pre-open the library
        // sidebar so the grid is visible without a click.
        const isLib =
          parsed.type === "excalidrawlib" ||
          filePath.toLowerCase().endsWith(".excalidrawlib");
        const next: ExcalidrawScene = isLib
          ? {
              elements: [],
              appState: { openSidebar: { name: "library" } },
              files: {},
              libraryItems: parsed.libraryItems ?? [],
            }
          : {
              elements: parsed.elements ?? [],
              appState: parsed.appState ?? {},
              files: parsed.files ?? {},
              libraryItems: null,
            };
        lastSavedContentHashRef.current = computeContentHash(
          next.elements,
          next.libraryItems ?? null,
        );
        startTransition(() => {
          setScene(next);
          setLoadError(null);
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        void logWarn(`excalidraw JSON parse failed: ${msg}`);
        startTransition(() => {
          setLoadError(msg);
          setScene(null);
        });
      }
    }

    return () => {
      cancelled = true;
    };
  }, [filePath, content, needsExtract, reloadKey]);

  // Issue #352 / iter-5 — the previous unmount cleanup that cleared
  // dirty + pending on every unmount has been REMOVED. That cleanup
  // was the iter-3 "fix" for the rubber-duck "extra blind spot" but
  // it actually caused silent data loss: it cleared the warning
  // signal so the user had no way to know their unsaved work was
  // gone after a tab switch. iter-5 replaces it with `setActiveTab`
  // and `setViewMode` GUARDS in the tabs slice (`Discard changes?`
  // prompt before the unmount), so by the time we get here the
  // user has already explicitly chosen to discard or cancel. No
  // unmount-time cleanup needed.

  // Listen for Save requests dispatched from the Save button + Ctrl+S
  // handler. Only the view whose `filePath` matches the event detail
  // responds. Scope to Editor mode — saving from Visual would persist
  // a stale snapshot.
  useEffect(() => {
    if (mode !== "editor") return;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { path: string } | undefined;
      if (!detail || detail.path !== filePath) return;
      // In-flight guard — a second save request while the first is in
      // progress is a no-op. The Rust side does atomic-write but cannot
      // reorder two near-simultaneous IPC calls, so we serialize at
      // the renderer boundary.
      if (saveInFlightRef.current) {
        void logWarn(`excalidraw save dropped (already in flight): ${filePath}`);
        return;
      }
      const live = liveSceneRef.current ?? scene;
      if (!live) return;
      saveInFlightRef.current = true;
      const wasFirstSave = !hasSeenFirstSave();
      // Snapshot the to-save content hash so we can update the
      // baseline on success — any subsequent onChange whose hash
      // matches this will correctly read as not-dirty.
      const savedHash = computeContentHash(live.elements, live.libraryItems ?? null);
      void saveExcalidrawFile(filePath, {
        elements: live.elements,
        appState: live.appState,
        files: live.files,
        libraryItems: live.libraryItems ?? null,
      })
        .then(() => {
          // Success — update the saved-content baseline so the next
          // hash comparison correctly sees "no edits since save",
          // clear dirty + pending + any prior save error.
          lastSavedContentHashRef.current = savedHash;
          setExcalidrawDirty(filePath, false);
          setExternalChangePending(filePath, false);
          setSaveError(null);
          // Issue #352 / iter-5 BLOCKER (product F5) — first-save
          // MRSF warning toast. Show ONLY on the first successful save
          // per browser profile, then never again.
          if (wasFirstSave) {
            markFirstSaveSeen();
            setShowFirstSaveWarning(true);
          }
        })
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          void logError(`excalidraw save failed for ${filePath}: ${msg}`);
          // Surface as a non-modal banner above the canvas — DO NOT
          // route through `setLoadError`, which would unmount the
          // canvas and discard the user's unsaved edits (rubber-duck +
          // product-expert blockers, iter-3 review). Dirty stays
          // true so the user can retry; the Save button stays "live".
          // Map the precise Rust error to user-facing copy
          // (product F3 — iter-5 blocker).
          setSaveError(friendlySaveError(msg));
        })
        .finally(() => {
          saveInFlightRef.current = false;
        });
    };
    window.addEventListener(EXCALIDRAW_SAVE_REQUEST, handler);
    return () => window.removeEventListener(EXCALIDRAW_SAVE_REQUEST, handler);
  }, [mode, filePath, scene, setExcalidrawDirty, setExternalChangePending]);

  const deferredScene = useDeferredValue(scene);

  if (loadError) {
    return (
      <div
        className="enhanced-viewer-content excalidraw-view excalidraw-view--error"
        data-testid="excalidraw-shell"
        data-mode={mode}
        data-path={filePath}
      >
        <p style={{ padding: "1rem", color: "var(--color-error, #c00)" }}>
          Failed to load Excalidraw scene: {loadError}
        </p>
      </div>
    );
  }

  if (!deferredScene) {
    return (
      <div
        className="enhanced-viewer-content excalidraw-view"
        data-testid="excalidraw-shell"
        data-mode={mode}
        data-path={filePath}
      >
        <SkeletonLoader />
      </div>
    );
  }

  return (
    <div
      className="enhanced-viewer-content excalidraw-view"
      data-testid="excalidraw-shell"
      data-mode={mode}
      data-path={filePath}
      data-dirty={dirty || undefined}
      style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column" }}
    >
      {showFirstSaveWarning && (
        <div
          className="excalidraw-first-save-warning-banner"
          role="status"
          data-testid="excalidraw-first-save-warning-banner"
        >
          <span className="excalidraw-first-save-warning-banner__copy">
            Saving a drawing may move some line-anchored comments to file-level.
          </span>
          <button
            type="button"
            className="excalidraw-conflict-banner__action"
            onClick={() => setShowFirstSaveWarning(false)}
          >
            Got it
          </button>
        </div>
      )}
      {mode === "editor" && saveError && (
        <div
          className="excalidraw-save-error-banner"
          role="alert"
          data-testid="excalidraw-save-error-banner"
        >
          <span className="excalidraw-save-error-banner__copy">
            Save failed: {saveError}
          </span>
          <button
            type="button"
            className="excalidraw-conflict-banner__action"
            onClick={() => {
              // Retry — clear the error and re-fire the save event
              // (same path the user's Save button or Ctrl+S would).
              setSaveError(null);
              window.dispatchEvent(
                new CustomEvent(EXCALIDRAW_SAVE_REQUEST, {
                  detail: { path: filePath },
                }),
              );
            }}
            data-testid="excalidraw-save-error-retry"
          >
            Retry
          </button>
          <button
            type="button"
            className="excalidraw-conflict-banner__action"
            onClick={() => setSaveError(null)}
          >
            Dismiss
          </button>
        </div>
      )}
      {mode === "editor" && externalChangePending && (
        <div
          className="excalidraw-conflict-banner"
          role="status"
          data-testid="excalidraw-conflict-banner"
        >
          <span className="excalidraw-conflict-banner__copy">
            File changed on disk
          </span>
          <button
            type="button"
            className="excalidraw-conflict-banner__action"
            onClick={() => {
              // Issue #352 / iter-5 BLOCKER (rubber-duck #2) — Reload
              // must FORCE a remount of <Excalidraw> + re-run of the
              // load effect (which calls extractScene for binary
              // variants OR re-parses content for canonical files).
              // Bumping reloadKey does both: (a) the load effect dep
              // includes reloadKey so it fires; (b) the Excalidraw
              // child gets a fresh `key={reloadKey}` so React mounts
              // a new instance with the freshly-parsed initialData.
              // Also clear dirty + pending and dispatch a synthetic
              // file-changed so `useFileContent` re-reads the on-disk
              // bytes (canonical files) — the load effect will then
              // see fresh `content`. Same event shape as
              // useFileWatcher.ts:74.
              setExcalidrawDirty(filePath, false);
              setExternalChangePending(filePath, false);
              setReloadKey((k) => k + 1);
              window.dispatchEvent(
                new CustomEvent("mdownreview:file-changed", {
                  detail: { path: filePath, kind: "content" },
                }),
              );
            }}
          >
            Reload
          </button>
          <button
            type="button"
            className="excalidraw-conflict-banner__action"
            onClick={() => {
              // Keep editing — clear pending only; dirty stays true so
              // the next Save will overwrite the on-disk version.
              setExternalChangePending(filePath, false);
            }}
          >
            Keep editing — your save will overwrite
          </button>
        </div>
      )}
      <div style={{ flex: 1, minHeight: 0 }}>
        <Excalidraw
          key={reloadKey}
          initialData={{
            elements: deferredScene.elements as never,
            appState: deferredScene.appState as never,
            files: deferredScene.files as never,
            // Issue #352 / iter-7 user-reported (#4) — `.excalidrawlib`
            // initial data populates the library panel via
            // `appState.openSidebar = { name: 'library' }` (set in the
            // load effect) plus the libraryItems array here.
            ...(deferredScene.libraryItems
              ? { libraryItems: deferredScene.libraryItems as never }
              : {}),
          }}
          viewModeEnabled={mode === "visual"}
          theme={excalidrawTheme}
          UIOptions={UI_OPTIONS}
          langCode="en"
          onChange={(elements, appState, files) => {
            // Always capture the latest snapshot for the save handler.
            // Library items live on appState, not files.
            liveSceneRef.current = {
              elements: elements as ReadonlyArray<unknown>,
              appState: appState as unknown as Record<string, unknown>,
              files: files as unknown as Record<string, unknown>,
              libraryItems:
                ((appState as unknown as { libraryItems?: ReadonlyArray<unknown> })
                  .libraryItems ?? null),
            };
            // Issue #352 / iter-7 user-reported BLOCKER (#3) — the
            // dirty flag is now CONTENT-driven, not event-driven.
            // Excalidraw fires onChange for every appState mutation
            // (tool selection, viewport pan, theme, cursor) — none of
            // which mutate persistent content. We compute a hash of
            // (elements + libraryItems) and compare against the
            // last-saved hash; dirty iff they differ. This eliminates
            // the false-positive dirty-on-mount-or-tool-click that
            // tab-title showed previously.
            if (mode !== "editor") return;
            const liveLibraryItems =
              ((appState as unknown as { libraryItems?: ReadonlyArray<unknown> })
                .libraryItems ?? null);
            const currentHash = computeContentHash(
              elements as ReadonlyArray<unknown>,
              liveLibraryItems,
            );
            const baseline = lastSavedContentHashRef.current;
            // baseline === null means the load effect hasn't published
            // its baseline yet; treat as not-yet-dirty (the first
            // genuine post-mount onChange will set it via the load
            // effect and subsequent comparisons will be accurate).
            if (baseline === null) return;
            // setExcalidrawDirty short-circuits when the boolean is
            // unchanged, so we don't pay a re-render per mouse-move.
            setExcalidrawDirty(filePath, currentHash !== baseline);
          }}
        />
      </div>
    </div>
  );
}
