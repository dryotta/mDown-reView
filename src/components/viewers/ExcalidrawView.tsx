import {
  Excalidraw,
} from "@excalidraw/excalidraw";
import { startTransition, useCallback, useDeferredValue, useEffect, useRef, useState } from "react";

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
 * Issue #352 / iter-10 redesign — auto-save debounce window.
 * After this many ms with no further onChange, the live scene is
 * persisted to disk via `saveExcalidrawFile`. 2s balances "snappy
 * persistence" against "every keystroke triggers an IPC".
 */
const AUTOSAVE_DEBOUNCE_MS = 2000;

/**
 * Issue #352 / iter-10 redesign — module-scope flag tracking whether
 * the user has dismissed the auto-save info banner THIS APP LAUNCH.
 * In-memory only; resets on every page reload / app restart so users
 * who forget the behaviour see the reminder again. (Per-app-launch
 * lifetime confirmed with the user during the iter-10 design phase.)
 */
let autoSaveBannerDismissedThisLaunch = false;

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
  // Issue #352 / iter-10 redesign — dismissible "auto-saves on change"
  // banner. Initialised from the module-scope flag so re-mounting a
  // viewer (e.g. tab switch) doesn't resurrect a banner the user
  // already dismissed this launch.
  const [autoSaveBannerVisible, setAutoSaveBannerVisible] = useState(
    () => !autoSaveBannerDismissedThisLaunch,
  );

  // Latest scene snapshot from Excalidraw's `onChange` — captured into a
  // ref so the save handler reads the current value without re-creating
  // the listener on every keystroke. Mirrors the pattern in `useImageData`
  // for one-shot listeners with always-fresh reads.
  const liveSceneRef = useRef<ExcalidrawScene | null>(null);

  // Issue #352 / iter-10 redesign — auto-save state.
  //   - `externalChangePending`: render-time gate for the conflict banner.
  //     Auto-save is paused while `true` so we don't clobber an external
  //     change before the user has chosen Reload vs Keep editing.
  //   - `saveInFlightRef`: prevents two saves running concurrently. The
  //     Rust workspace-write IPC is atomic per call but cannot reorder
  //     two near-simultaneous calls, so we serialise at the renderer
  //     boundary and coalesce missed onChanges via `pendingSaveRef`.
  //   - `autoSaveTimerRef`: window.setTimeout id for the debounced save.
  //     Cleared on every onChange (debounce reset) and on unmount.
  //   - `pendingSaveRef`: set to `true` when an onChange fires while a
  //     save is already in flight. After the in-flight save resolves we
  //     check this flag and schedule another save so the user's latest
  //     edit still lands on disk.
  const externalChangePending = useStore(
    (s) => s.externalChangePendingByTab[filePath] === true,
  );
  const saveInFlightRef = useRef(false);
  const autoSaveTimerRef = useRef<number | null>(null);
  const pendingSaveRef = useRef(false);
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

    if (needsExtract) {
      // PNG / SVG variant — Excalidraw's loadFromBlob decodes the embedded
      // scene chunk. Wrapped in startTransition so a 5MB PNG decode doesn't
      // block urgent UI updates (perf rule 12, mirrors useSourceHighlighting).
      extractScene(filePath)
        .then((extracted) => {
          if (cancelled) return;
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
        //
        // Issue #352 / iter-8 user-reported BUG#3 — Excalidraw's
        // sidebar API is `{ name: DEFAULT_SIDEBAR.name, tab: <tabId> }`
        // where `DEFAULT_SIDEBAR.name === "default"` and the library
        // tab is `"library"`. The previous shape `{ name: "library" }`
        // did not match any registered sidebar, so the panel never
        // opened and the library grid was invisible.
        const isLib =
          parsed.type === "excalidrawlib" ||
          filePath.toLowerCase().endsWith(".excalidrawlib");
        const next: ExcalidrawScene = isLib
          ? {
              elements: [],
              appState: { openSidebar: { name: "default", tab: "library" } },
              files: {},
              libraryItems: parsed.libraryItems ?? [],
            }
          : {
              elements: parsed.elements ?? [],
              appState: parsed.appState ?? {},
              files: parsed.files ?? {},
              libraryItems: null,
            };
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

  // Issue #352 / iter-10 redesign — auto-save core. `runAutoSave`
  // is the single save path: serialises the live scene, calls the
  // workspace-write IPC, and surfaces failures via the saveError
  // banner. Coalesces concurrent calls via `saveInFlightRef` and
  // re-fires once the in-flight save resolves if a later onChange
  // arrived during it (`pendingSaveRef`).
  //
  // Wrapped in a stable `useCallback` so the onChange-driven
  // scheduler can list it in deps without re-registering listeners
  // on every re-render. `liveSceneRef`/refs are read INSIDE so we
  // see the latest scene at flush time, not at scheduler-creation
  // time.
  // `runAutoSaveRef` holds the latest `runAutoSave` so the queued
  // follow-up after an in-flight save resolves can call it without
  // the callback referencing itself (which the React-compiler lint
  // flags). Updated in an effect after each render.
  const runAutoSaveRef = useRef<() => void>(() => {});
  const runAutoSave = useCallback(() => {
    if (mode !== "editor") return;
    if (externalChangePending) {
      // Conflict banner is up — do not clobber the on-disk version.
      // The user must explicitly resolve via Reload or Keep editing.
      return;
    }
    if (saveInFlightRef.current) {
      // Another save is already running. Mark a follow-up so the
      // user's latest edits land on disk after the in-flight call
      // resolves.
      pendingSaveRef.current = true;
      return;
    }
    const live = liveSceneRef.current ?? scene;
    if (!live) return;
    saveInFlightRef.current = true;
    const wasFirstSave = !hasSeenFirstSave();
    void saveExcalidrawFile(filePath, {
      elements: live.elements,
      appState: live.appState,
      files: live.files,
      libraryItems: live.libraryItems ?? null,
    })
      .then(() => {
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
        void logError(`excalidraw auto-save failed for ${filePath}: ${msg}`);
        // Surface as a non-modal banner above the canvas — DO NOT
        // route through `setLoadError`, which would unmount the
        // canvas and discard the user's unsaved edits (rubber-duck +
        // product-expert blockers, iter-3 review). Map the precise
        // Rust error to user-facing copy (product F3 — iter-5).
        setSaveError(friendlySaveError(msg));
      })
      .finally(() => {
        saveInFlightRef.current = false;
        // If a coalesced save was queued during the in-flight call,
        // schedule it now so the latest edits make it to disk.
        if (pendingSaveRef.current) {
          pendingSaveRef.current = false;
          // Use a microtask-ish delay (0) rather than the full debounce
          // — the user has already paused for 2s once; firing the
          // follow-up right away keeps the on-disk state fresh.
          autoSaveTimerRef.current = window.setTimeout(() => {
            autoSaveTimerRef.current = null;
            runAutoSaveRef.current();
          }, 0);
        }
      });
  }, [mode, filePath, scene, externalChangePending]);

  useEffect(() => {
    runAutoSaveRef.current = runAutoSave;
  }, [runAutoSave]);

  // Cancel any pending auto-save on unmount or when deps change so we
  // don't fire a stale save against a tab the user has navigated away
  // from. Safe even if the timer has already fired (clearTimeout is
  // a no-op for unknown ids).
  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current !== null) {
        clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
    };
  }, [filePath]);

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
      style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column" }}
    >
      {mode === "editor" && autoSaveBannerVisible && (
        <div
          className="excalidraw-autosave-banner"
          role="status"
          data-testid="excalidraw-autosave-banner"
        >
          <span className="excalidraw-autosave-banner__copy">
            Drawing auto-saves on change.
          </span>
          <button
            type="button"
            className="excalidraw-conflict-banner__action"
            onClick={() => {
              // Persist dismissal at module scope so re-mounts (tab
              // switch, reload key bump) don't resurrect the banner.
              autoSaveBannerDismissedThisLaunch = true;
              setAutoSaveBannerVisible(false);
            }}
            data-testid="excalidraw-autosave-banner-dismiss"
          >
            Got it
          </button>
        </div>
      )}
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
              // Retry — clear the error and immediately attempt
              // another save. Bypasses the debounce timer.
              setSaveError(null);
              runAutoSave();
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
              // Cancel any pending auto-save so the in-flight scene
              // doesn't clobber the freshly-loaded one. Clear the
              // pending-conflict flag so auto-save resumes against
              // the new baseline.
              if (autoSaveTimerRef.current !== null) {
                clearTimeout(autoSaveTimerRef.current);
                autoSaveTimerRef.current = null;
              }
              pendingSaveRef.current = false;
              useStore.getState().setExternalChangePending(filePath, false);
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
              // Keep editing — clear pending so the auto-save loop
              // resumes; the next save will overwrite the on-disk
              // version.
              useStore.getState().setExternalChangePending(filePath, false);
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
          excalidrawAPI={(api) => {
            // Issue #352 / iter-8 — capture the Excalidraw imperative
            // API. In Vite dev builds we also stash it on `window` so
            // browser-E2E specs can drive deterministic scene mutations
            // (e.g. inject a rectangle) without depending on flaky
            // canvas pointer events. Production builds skip the window
            // assignment — the surrounding `if (false) {…}` is
            // dead-code-eliminated by Rollup, so no production bytes
            // contain the assignment.
            if (import.meta.env.DEV && typeof window !== "undefined") {
              (window as unknown as {
                __EXCALIDRAW_API__?: typeof api;
              }).__EXCALIDRAW_API__ = api;
            }
          }}
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
            // Issue #352 / iter-10 redesign — auto-save scheduler.
            // Excalidraw fires onChange for both real edits and
            // non-content events (tool selection, viewport pan,
            // theme, cursor). For dirty tracking we used to filter
            // those out via a content hash; for auto-save we don't
            // need to — saving the same bytes back to disk is a
            // no-op (Rust workspace-write atomic-replaces, file
            // mtime advances but the content is identical, watcher
            // dedupes). Keeping the scheduler simple avoids the
            // hash-volatility bugs from iter-7 → iter-9.
            //
            // Pause auto-save while NOT in editor mode (Visual /
            // Source must not write back) and while the conflict
            // banner is up (don't clobber an external change).
            if (mode !== "editor") return;
            if (autoSaveTimerRef.current !== null) {
              clearTimeout(autoSaveTimerRef.current);
            }
            autoSaveTimerRef.current = window.setTimeout(() => {
              autoSaveTimerRef.current = null;
              runAutoSave();
            }, AUTOSAVE_DEBOUNCE_MS);
          }}
        />
      </div>
    </div>
  );
}
