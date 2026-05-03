import { Excalidraw } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useEffect, useRef, useState } from "react";

import { SkeletonLoader } from "./SkeletonLoader";
import {
  ConflictBanner,
  FirstEntryBanner,
  SavedPill,
  SaveErrorBanner,
} from "./excalidraw/ExcalidrawBanners";

import { useTheme } from "@/hooks/useTheme";
import { useExcalidrawAutoSave } from "@/hooks/useExcalidrawAutoSave";
import { useExcalidrawScene } from "@/hooks/useExcalidrawScene";
import { seenFlag } from "@/lib/excalidraw/seen-flag";
import { getFiletypeKey } from "@/lib/file-types";
import { warn as logWarn } from "@/logger";
import { useStore } from "@/store";
import { ZOOM_DEFAULT } from "@/store/viewerPrefs";

import "@excalidraw/excalidraw/index.css";
import "@/styles/viewer-banner.css";

// First-Editor-entry one-shot disclosure (combined autosave-info +
// MRSF warning). Pre-merge there were two separate flags
// (`mdownreview:excalidraw-autosave-banner-seen` and
// `mdownreview:excalidraw-first-save-warning-seen`); both are still
// consulted on read so users who dismissed EITHER previous banner
// don't get re-shown the merged version. New "first-entry-seen" flag
// is the authoritative writer going forward (review finding
// product-expert P0-2: stacking two banners ate canvas height).
const FIRST_ENTRY = seenFlag("mdownreview:excalidraw-first-entry-seen");
const LEGACY_AUTOSAVE_BANNER = seenFlag(
  "mdownreview:excalidraw-autosave-banner-seen",
);
const LEGACY_MRSF_WARNING = seenFlag(
  "mdownreview:excalidraw-first-save-warning-seen",
);

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
 *   - `saveToActiveFile`  — Excalidraw's built-in save (workspace-write IPC owns saves).
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
 * Issue #352 / iter-12 — Excalidraw viewer shell.
 *
 * Thin View component (per Rust-First MVVM, `docs/principles.md` § 1):
 *   - Scene loading: `useExcalidrawScene` (`src/hooks/useExcalidrawScene.ts`)
 *   - Autosave state machine: `useExcalidrawAutoSave`
 *     (`src/hooks/useExcalidrawAutoSave.ts`)
 *   - Banners: `ExcalidrawBanners.tsx` (presentational only)
 *   - Error mapping: `lib/excalidraw/error-mapping.ts`
 *   - Snapshot hashing: `lib/excalidraw/stable-hash.ts`
 *   - Save IPC: `lib/excalidraw/saveScene.ts` →
 *     `commands::fs_write::write_workspace_text/binary` (Rust)
 *   - Close-flush handshake: `useExcalidrawCloseFlush` mounted at the
 *     App root + `flush-registry.ts` module-scope registry.
 *
 * This file holds only the JSX wiring + a few module-scope singletons.
 * No business logic, no IPC calls, no scene hashing. Architect blocker
 * #1 (rule 23 file-size cap, `docs/architecture.md`) was the trigger
 * for the iter-12 split.
 */
export function ExcalidrawView({ content, filePath, mode, needsExtract }: Props) {
  const theme = useTheme();
  const excalidrawTheme: "light" | "dark" = theme === "dark" ? "dark" : "light";

  // Reload-key forces a remount of `<Excalidraw>` + re-runs the load
  // effect when the user clicks Reload on the conflict banner.
  // Excalidraw consumes `initialData` only at mount; without bumping
  // this key the banner click would do nothing for canonical files.
  const [reloadKey, setReloadKey] = useState(0);

  const { scene, loadError } = useExcalidrawScene(
    filePath,
    content,
    needsExtract,
    reloadKey,
  );

  const externalChangePending = useStore(
    (s) => s.externalChangePendingByTab[filePath] === true,
  );

  const {
    notifyChange,
    flush,
    resetBaseline,
    saveError,
    clearSaveError,
    autoSavePaused,
    retryAfterFailure,
    savedPillVisible,
  } = useExcalidrawAutoSave(filePath, mode, externalChangePending);

  // Iter-18 (user-reported regression) — toolbar zoom buttons used
  // to no-op for Excalidraw because the React `zoomByFiletype` value
  // was never plumbed into the canvas. Subscribe here and push it
  // into Excalidraw via the imperative `excalidrawAPI.updateScene`
  // whenever the value changes. Filetype key derived via
  // `getFiletypeKey(filePath, mode)` so it stays in lock-step with
  // `EnhancedViewer` and Ctrl+= / Ctrl+- / Ctrl+0 shortcuts.
  // (react-tauri-expert MEDIUM — eliminates hardcoded literal drift.)
  //
  // Bottom-up commit: by the time this parent effect fires after
  // first commit, the child's `excalidrawAPI` callback has already
  // populated `excalidrawAPIRef`. We do NOT push from inside the
  // `excalidrawAPI` callback synchronously — it triggers a
  // setState-on-unmounted-component warning inside Excalidraw's
  // internal state machine (caught in iter-18 release-gate Linux/
  // macOS browser e2e). The effect is the sole pusher.
  const filetypeKey = getFiletypeKey(filePath, mode);
  const toolbarZoom = useStore(
    (s) => s.zoomByFiletype[filetypeKey] ?? ZOOM_DEFAULT,
  );
  const excalidrawAPIRef = useRef<ExcalidrawImperativeAPI | null>(null);
  useEffect(() => {
    const api = excalidrawAPIRef.current;
    if (!api) return;
    try {
      api.updateScene({
        appState: { zoom: { value: toolbarZoom } } as never,
      });
    } catch (err: unknown) {
      // Defensive: if Excalidraw bumps the updateScene contract in a
      // future version, log and degrade rather than throw an
      // unhandled error through React's error boundary path. Users
      // see "zoom button does nothing" with a logged trace instead
      // of a crashed canvas. (react-tauri-expert HIGH.)
      void logWarn(
        `[excalidraw] zoom updateScene failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }, [toolbarZoom, reloadKey]);

  // Banner dismissal state. Single combined first-Editor-entry
  // disclosure replaces the iter-12 two-banner stack (review finding
  // product-expert P0-2 + P0-3). Initialised lazily so remounts don't
  // resurrect a banner the user already dismissed (the seen-flag
  // helpers persist across page reloads). Honour any of the three
  // flags so users who already dismissed either of the previous two
  // banners are not re-shown the merged version.
  const [firstEntryBannerVisible, setFirstEntryBannerVisible] = useState(
    () =>
      !FIRST_ENTRY.has() &&
      !LEGACY_AUTOSAVE_BANNER.has() &&
      !LEGACY_MRSF_WARNING.has(),
  );

  // First-Editor-entry banner — fires AT MOST ONCE per browser
  // profile across the entire app lifetime. Surfaces proactively
  // (under autosave the user has no explicit save action; the
  // disclosure must precede the first edit-becomes-save).
  useEffect(() => {
    if (mode !== "editor") return;
    if (FIRST_ENTRY.has()) return;
    FIRST_ENTRY.mark();
  }, [mode]);

  // Cmd+S flush event — the renderer-side hook
  // `useGlobalShortcuts` dispatches `mdownreview:excalidraw-flush-save`
  // when the user presses Cmd/Ctrl+S in an Excalidraw editor tab. Only
  // the view whose `filePath` matches the event detail responds; other
  // editor instances ignore.
  //
  // Pass `{ userInitiated: true }` so the autosave hook gates the
  // transient "Saved" pill on a real successful write — without this
  // the pill would flash even when the save was paused (3-strike
  // failure-pause), skipped (no diff vs baseline), short-circuited by
  // the conflict banner, or otherwise short-circuited (review finding
  // bug-expert P1#1).
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { path: string } | undefined;
      if (!detail || detail.path !== filePath) return;
      flush({ userInitiated: true });
    };
    window.addEventListener("mdownreview:excalidraw-flush-save", handler);
    return () => {
      window.removeEventListener("mdownreview:excalidraw-flush-save", handler);
    };
  }, [filePath, flush]);

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
      {savedPillVisible && <SavedPill />}
      {mode === "editor" && firstEntryBannerVisible && (
        <FirstEntryBanner
          onDismiss={() => {
            FIRST_ENTRY.mark();
            setFirstEntryBannerVisible(false);
          }}
        />
      )}
      {mode === "editor" && saveError && (
        <SaveErrorBanner
          message={saveError}
          paused={autoSavePaused}
          onRetry={retryAfterFailure}
          onDismiss={clearSaveError}
        />
      )}
      {mode === "editor" && externalChangePending && (
        <ConflictBanner
          onReload={() => {
            // Reload must FORCE a remount of <Excalidraw> + re-run of
            // the load effect (which calls extractScene for binary
            // variants OR re-parses content for canonical files).
            // Bumping reloadKey does both: (a) the load effect dep
            // includes reloadKey so it fires; (b) the Excalidraw child
            // gets a fresh `key={reloadKey}` so React mounts a new
            // instance with the freshly-parsed initialData.
            //
            // Crucially (iter-12 bug #3 — Reload no-op for canonical
            // files): clear `excalidrawDirty` BEFORE dispatching, so
            // the `useFileContent` listener takes the non-conflict
            // branch and re-reads disk. Without this the listener
            // sees `isEditor && isDirty` and re-arms
            // externalChangePending instead of reloading. Reset the
            // autosave baseline too so the post-reload first onChange
            // re-baselines.
            useStore.getState().setExcalidrawDirty(filePath, false);
            resetBaseline();
            useStore.getState().setExternalChangePending(filePath, false);
            setReloadKey((k) => k + 1);
            window.dispatchEvent(
              new CustomEvent("mdownreview:file-changed", {
                detail: { path: filePath, kind: "content" },
              }),
            );
          }}
          onKeepEditing={() => {
            // Keep editing — clear pending so the auto-save loop
            // resumes, then FLUSH immediately (review finding
            // bug-expert P2#3). The "Keep editing — overwrite" copy
            // implies the overwrite happens at click time. Without
            // an immediate flush, the user's divergent in-memory
            // version persists only to RAM until the next onChange,
            // so a power loss / OOM kill before then would silently
            // drop the user's changes (close-flush handshake is
            // best-effort over CloseRequested only).
            useStore.getState().setExternalChangePending(filePath, false);
            flush();
          }}
        />
      )}
      <div style={{ flex: 1, minHeight: 0 }}>
        <Excalidraw
          key={reloadKey}
          initialData={{
            elements: scene.elements as never,
            appState: scene.appState as never,
            files: scene.files as never,
            // `.excalidrawlib` initial data populates the library panel
            // via `appState.openSidebar = { name: 'default', tab:
            // 'library' }` (set in the load hook) plus the libraryItems
            // array here.
            ...(scene.libraryItems
              ? { libraryItems: scene.libraryItems as never }
              : {}),
          }}
          viewModeEnabled={mode === "visual"}
          theme={excalidrawTheme}
          UIOptions={UI_OPTIONS}
          langCode="en"
          excalidrawAPI={(api) => {
            // Iter-18 — capture the imperative API so the
            // toolbar-zoom effect (above) can push zoom updates
            // into the canvas. Excalidraw invokes this callback
            // once per mount from inside its own effect (post-
            // commit), so by the time the parent effect runs the
            // ref is populated. We do NOT issue an inline
            // updateScene here: synchronous mutation during the
            // first-mount callback triggers Excalidraw's internal
            // setState-on-unmounted-component warning (caught in
            // iter-18 release-gate browser e2e on Linux + macOS).
            excalidrawAPIRef.current = api;
            // In Vite dev builds we stash the imperative API on
            // `window` so browser-E2E specs can drive deterministic
            // scene mutations (e.g. inject a rectangle) without
            // depending on flaky canvas pointer events. Production
            // builds omit the assignment via dead-code elimination.
            if (import.meta.env.DEV && typeof window !== "undefined") {
              (window as unknown as {
                __EXCALIDRAW_API__?: typeof api;
              }).__EXCALIDRAW_API__ = api;
            }
          }}
          onChange={(elements, appState, files) => {
            notifyChange({
              elements: elements as ReadonlyArray<unknown>,
              appState: appState as unknown as Record<string, unknown>,
              files: files as unknown as Record<string, unknown>,
              libraryItems:
                ((appState as unknown as { libraryItems?: ReadonlyArray<unknown> })
                  .libraryItems ?? null),
            });
          }}
        />
      </div>
    </div>
  );
}
