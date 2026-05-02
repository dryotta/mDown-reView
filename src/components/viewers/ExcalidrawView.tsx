import {
  Excalidraw,
} from "@excalidraw/excalidraw";
import { startTransition, useEffect, useRef, useState } from "react";

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

/**
 * Issue #352 / iter-11 — STABLE content hash for auto-save divergence
 * detection. Strips Excalidraw's volatile `version` / `versionNonce` /
 * `updated` fields (mutated on every operation including mount-time
 * normalisation passes) so the hash reflects PERSISTENT content only.
 *
 * Two scenes hash equal iff their persistent content (elements,
 * library items, appState) is the same. Tool selection, viewport pan,
 * cursor position, and Excalidraw's mount-time versionNonce churn do
 * NOT shift the hash.
 *
 * Used by the auto-save debouncer to skip the IPC when the live scene
 * is byte-identical to what's already on disk (lastSavedHashRef).
 */
function stableContentHash(
  elements: ReadonlyArray<unknown>,
  libraryItems: ReadonlyArray<unknown> | null,
): string {
  const stripVolatile = (el: unknown): Record<string, unknown> => {
    if (el === null || typeof el !== "object") return {};
    const { version: _v, versionNonce: _vn, updated: _u, ...rest } =
      el as Record<string, unknown>;
    return rest;
  };
  const stableElements = elements.map(stripVolatile);
  const stableLib =
    libraryItems !== null && libraryItems.length > 0
      ? libraryItems.map((item) => {
          const stripped = stripVolatile(item);
          // Library items contain nested elements that ALSO carry the
          // volatile fields — strip them too, otherwise lib hash drifts.
          const innerElements = Array.isArray(stripped.elements)
            ? (stripped.elements as unknown[]).map(stripVolatile)
            : stripped.elements;
          return { ...stripped, elements: innerElements };
        })
      : null;
  return JSON.stringify({ elements: stableElements, libraryItems: stableLib });
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

  // Refs (rule: high-frequency / non-render state is in refs).
  //
  //   - `liveSceneRef`: latest scene snapshot from Excalidraw's
  //     `onChange`. Read at save time so we capture the user's most
  //     recent edits.
  //   - `lastSavedHashRef`: stable content hash of the LAST successful
  //     save (or the post-mount baseline if no save has fired yet).
  //     iter-11 uses byte-level comparison via a stable hash that
  //     strips Excalidraw's volatile `version` / `versionNonce` /
  //     `updated` fields — those mutate on every operation including
  //     mount-time normalisation passes (font load, library merge),
  //     which would otherwise drive constant false-positive saves.
  //   - `saveInFlightRef`: serialises concurrent saves at the renderer.
  //     The Rust workspace-write IPC is atomic per call but cannot
  //     reorder two near-simultaneous calls.
  //   - `pendingSaveRef`: set when an onChange arrives while a save
  //     is already in flight. After the in-flight save resolves we
  //     schedule a follow-up so the user's latest edit lands on disk.
  //   - `autoSaveTimerRef`: window.setTimeout id for the debounced save.
  //   - `mountedRef`: gates post-unmount state updates and the in-flight
  //     follow-up scheduler so a torn-down view doesn't fire ghost saves
  //     or call setState on an unmounted component.
  const liveSceneRef = useRef<ExcalidrawScene | null>(null);
  const lastSavedHashRef = useRef<string | null>(null);
  const saveInFlightRef = useRef(false);
  const pendingSaveRef = useRef(false);
  const autoSaveTimerRef = useRef<number | null>(null);
  const mountedRef = useRef(true);

  const externalChangePending = useStore(
    (s) => s.externalChangePendingByTab[filePath] === true,
  );
  // Issue #352 / iter-11 — auto-save lifecycle wiring. We call:
  //   * `setExcalidrawDirty(path, true)` when the live scene diverges
  //     from the last-saved baseline (gates the conflict banner in
  //     `useFileContent` so external changes during edit are surfaced
  //     instead of silently overwritten).
  //   * `setExcalidrawDirty(path, false)` after a successful save.
  //   * `recordSave(path)` after a successful save (suppresses the
  //     watcher echo so our own write doesn't trigger a remount loop;
  //     see `useFileWatcher.ts:82-87`).
  const setExcalidrawDirty = useStore((s) => s.setExcalidrawDirty);
  const recordSave = useStore((s) => s.recordSave);

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

  // Issue #352 / iter-11 — auto-save core.
  //
  // Architecture: `performSave` is a stable function that reads
  // reactive props/state (mode, externalChangePending) via refs so
  // the debounce timer or Retry click can call it later without
  // closure traps. Two entry points wrap it:
  //   - `runAutoSave`: subject to mode + externalChangePending gates
  //     (the normal debounce path).
  //   - `flushAutoSave`: BYPASSES the mode gate (we're flushing
  //     precisely because we're about to lose `mode==="editor"`),
  //     but still respects `externalChangePending`.
  //
  // Why refs instead of `useEffectEvent`: the React Hooks lint rule
  // restricts useEffectEvent to Effect bodies, but our setTimeout
  // callback fires outside any effect — and the Retry click handler
  // is an event handler. The ref-mirror pattern is the supported
  // alternative and keeps the lint clean.
  const modeRef = useRef(mode);
  const externalChangePendingRef = useRef(externalChangePending);
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);
  useEffect(() => {
    externalChangePendingRef.current = externalChangePending;
  }, [externalChangePending]);

  const performSave = (bypassModeCheck: boolean): void => {
    if (!mountedRef.current) return;
    if (!bypassModeCheck && modeRef.current !== "editor") return;
    if (externalChangePendingRef.current) {
      // Conflict banner is up — do not clobber the on-disk version.
      // The user must explicitly resolve via Reload or Keep editing.
      return;
    }
    if (saveInFlightRef.current) {
      // Another save is running; queue a follow-up so the latest
      // edits still land on disk.
      pendingSaveRef.current = true;
      return;
    }
    const live = liveSceneRef.current;
    if (!live) return;
    const liveHash = stableContentHash(
      live.elements,
      live.libraryItems ?? null,
    );
    if (liveHash === lastSavedHashRef.current) {
      // No persistent-content drift since the last save (or the
      // post-mount baseline). Skip the IPC entirely — this is what
      // suppresses the iter-7/iter-9 "save fires on mount" bug:
      // Excalidraw normalises on mount and emits onChange events
      // with bumped versionNonces; the stable hash strips those, so
      // the first onChange post-mount captures the same hash as
      // subsequent normalisation events.
      return;
    }
    saveInFlightRef.current = true;
    const wasFirstSave = !hasSeenFirstSave();
    const savedHash = liveHash;
    void saveExcalidrawFile(filePath, {
      elements: live.elements,
      appState: live.appState,
      files: live.files,
      libraryItems: live.libraryItems ?? null,
    })
      .then(() => {
        // Update the on-disk baseline so the next divergence check
        // sees the just-saved scene as canonical.
        lastSavedHashRef.current = savedHash;
        if (!mountedRef.current) return;
        setSaveError(null);
        // Tell `useFileWatcher` this was OUR save so it can suppress
        // the watcher echo (otherwise our save → watcher → reload
        // chain churns indefinitely).
        recordSave(filePath);
        // Clear dirty so the conflict-banner gate in `useFileContent`
        // resets — external edits arriving AFTER this save will see
        // dirty===false and trigger a clean reload, not a conflict.
        setExcalidrawDirty(filePath, false);
        // Issue #352 / iter-5 BLOCKER (product F5) — first-save
        // MRSF warning. Show ONLY on the first successful save per
        // browser profile, then never again.
        if (wasFirstSave) {
          markFirstSaveSeen();
          setShowFirstSaveWarning(true);
        }
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        void logError(`excalidraw auto-save failed for ${filePath}: ${msg}`);
        if (!mountedRef.current) return;
        // Surface as a non-modal banner above the canvas — DO NOT
        // route through `setLoadError`, which would unmount the
        // canvas and discard the user's unsaved edits (rubber-duck +
        // product-expert blockers, iter-3 review). Map the precise
        // Rust error to user-facing copy (product F3 — iter-5).
        setSaveError(friendlySaveError(msg));
      })
      .finally(() => {
        saveInFlightRef.current = false;
        if (!mountedRef.current) return;
        // If a coalesced save was queued during the in-flight call,
        // schedule it now via the standard debounce so the latest
        // edits make it to disk.
        if (pendingSaveRef.current) {
          pendingSaveRef.current = false;
          autoSaveTimerRef.current = window.setTimeout(() => {
            autoSaveTimerRef.current = null;
            performSave(false);
          }, 0);
        }
      });
  };

  const runAutoSave = (): void => {
    performSave(false);
  };

  const flushAutoSave = (): void => {
    if (autoSaveTimerRef.current !== null) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
    performSave(true);
  };

  // Mirror the latest `flushAutoSave` into a ref so unmount/mode-leave
  // effects can call it without re-firing on every render. Updated in
  // an effect (cannot write to refs during render per React Compiler).
  const flushAutoSaveRef = useRef(flushAutoSave);
  useEffect(() => {
    flushAutoSaveRef.current = flushAutoSave;
  });

  // Mount tracker + cleanup. On unmount we FLUSH (not cancel) the
  // pending debounce so a tab switch within 2s doesn't lose the user's
  // edits. Then mark the component unmounted so async save callbacks
  // skip setState. Empty deps — runs once.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      flushAutoSaveRef.current();
      mountedRef.current = false;
    };
  }, []);

  // Flush on EDITOR-LEAVE: the user clicked Source/Visual on a tab
  // they were editing. Without this, the in-flight debounce fires
  // post-mode-change with mode!=="editor" and bails — losing the edit.
  const wasEditorRef = useRef(mode === "editor");
  useEffect(() => {
    const wasEditor = wasEditorRef.current;
    wasEditorRef.current = mode === "editor";
    if (wasEditor && mode !== "editor") {
      flushAutoSaveRef.current();
    }
  }, [mode]);

  // Reset the post-mount baseline when the tab's source-of-truth
  // changes (filePath, on-disk content, reloadKey from Reload button,
  // or needsExtract for binary variants). The next onChange after a
  // load captures the new baseline; subsequent edits are detected
  // via stableContentHash divergence.
  useEffect(() => {
    lastSavedHashRef.current = null;
  }, [filePath, content, needsExtract, reloadKey]);

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

  if (!scene) {
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
            elements: scene.elements as never,
            appState: scene.appState as never,
            files: scene.files as never,
            // Issue #352 / iter-7 user-reported (#4) — `.excalidrawlib`
            // initial data populates the library panel via
            // `appState.openSidebar = { name: 'library' }` (set in the
            // load effect) plus the libraryItems array here.
            ...(scene.libraryItems
              ? { libraryItems: scene.libraryItems as never }
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
            const live: ExcalidrawScene = {
              elements: elements as ReadonlyArray<unknown>,
              appState: appState as unknown as Record<string, unknown>,
              files: files as unknown as Record<string, unknown>,
              libraryItems:
                ((appState as unknown as { libraryItems?: ReadonlyArray<unknown> })
                  .libraryItems ?? null),
            };
            liveSceneRef.current = live;
            // Issue #352 / iter-11 — auto-save scheduler.
            //
            // Excalidraw fires onChange for both real edits and non-content
            // events (tool selection, viewport pan, theme, cursor). The
            // stableContentHash check inside `performSave` filters those
            // out at SAVE time so we don't pay an IPC for non-content
            // events even though we scheduled a debounce.
            //
            // Bootstrap baseline: the FIRST onChange after a load captures
            // the current hash as the on-disk baseline. This ensures the
            // mount-time normalisation onChanges (which Excalidraw fires
            // with bumped versionNonces, stripped by stableContentHash to
            // match the loaded scene's hash) don't trigger a save just
            // because the file was opened.
            //
            // We also flip the dirty flag here when content has actually
            // diverged from baseline — that's the conflict-banner gate
            // in `useFileContent` (set when buffer != on-disk; clear on
            // save success).
            if (mode !== "editor") return;
            const liveHash = stableContentHash(
              live.elements,
              live.libraryItems ?? null,
            );
            if (lastSavedHashRef.current === null) {
              // First post-load onChange — this IS the on-disk
              // canonical form (Excalidraw normalises on mount; the
              // stable hash strips the volatile fields).
              lastSavedHashRef.current = liveHash;
              return;
            }
            if (liveHash === lastSavedHashRef.current) {
              // Non-content event (tool change, pan, etc.). Don't
              // touch dirty; don't reschedule the save.
              return;
            }
            // Real content drift. Mark dirty (gates the conflict
            // banner) and reset the debounce.
            setExcalidrawDirty(filePath, true);
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
