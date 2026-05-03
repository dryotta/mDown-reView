import { Excalidraw } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useEffect, useRef, useState } from "react";

import { SkeletonLoader } from "./SkeletonLoader";
import {
  ConflictBanner,
  FirstEntryBanner,
  LineAnchoredCommentsBanner,
  SavedPill,
  SaveErrorBanner,
  SaveStatusIndicator,
  type SaveStatus,
} from "./excalidraw/ExcalidrawBanners";

import { useTheme } from "@/hooks/useTheme";
import { useExcalidrawAutoSave } from "@/hooks/useExcalidrawAutoSave";
import { useExcalidrawScene } from "@/hooks/useExcalidrawScene";
import { seenFlag } from "@/lib/excalidraw/seen-flag";
import { getFiletypeKey } from "@/lib/file-types";
import { getFileBadges } from "@/lib/tauri-commands";
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
 * Iter-22 (#352 product-expert iter-21 P0 — MRSF re-anchor "once per
 * profile" gap) — session-scoped per-file dismissal of the line-
 * anchored-comments warning banner. Rendered when a user enters
 * Editor mode for an `.excalidraw[lib]` whose MRSF sidecar carries
 * unresolved comments pinned to specific lines. Module-scope `Set`
 * survives across Editor↔Visual mode toggles within the same window
 * lifetime; cleared by closing/reloading the app. New session →
 * re-warn (the cost is one click; the cost of silently degrading
 * another reviewer's comment thread is irreversible).
 *
 * Cleared by `__TEST_ONLY_clearLineAnchoredDismissals` for unit tests.
 */
const lineAnchoredDismissedThisSession = new Set<string>();
export function __TEST_ONLY_clearLineAnchoredDismissals(): void {
  lineAnchoredDismissedThisSession.clear();
}

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

  // Iter-21 (#352 P0-2) — canonical reload uses the content-prop
  // change driven by `useFileContent`'s re-fetch as the trigger;
  // bumping a local key for canonical files synchronously re-fires
  // `useExcalidrawScene`'s effect with the OLD `content` and
  // remounts Excalidraw with stale data before the async re-read
  // commits. For binary `.excalidraw.png` / `.excalidraw.svg`
  // variants `content` is sentinel-empty, so a local `reloadKey`
  // bump is the only way to re-trigger `extractScene`. We keep
  // the local key for the binary path only.
  const [reloadKey, setReloadKey] = useState(0);

  const { scene, loadError, loadVersion } = useExcalidrawScene(
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
    notifyLibraryChange,
    setBaselineLibrary,
    flush,
    resetBaseline,
    saveError,
    clearSaveError,
    autoSavePaused,
    retryAfterFailure,
    savedPillVisible,
    saveInFlight,
  } = useExcalidrawAutoSave(filePath, mode, externalChangePending);

  // Iter-21 (#352 product-expert P0-2) — derive the persistent
  // save-status pill state. Read `excalidrawDirty` directly from
  // the store so the pill flips synchronously when notifyChange
  // marks dirty (without re-rendering on unrelated store mutations).
  const isDirty = useStore(
    (s) => s.excalidrawDirtyByTab[filePath] === true,
  );
  // Iter-22 (#352 bug-expert iter-21 P1-3): paused has highest
  // priority. Pre-iter-22 a paused state with `isDirty=true` fell
  // through to "Unsaved" — a forward-looking promise that the
  // autosave loop cannot keep until the user clicks Resume. The
  // SaveErrorBanner already shows "Auto-save paused after repeated
  // failures" with [Resume] (Dismiss is hidden in the paused state
  // per iter-21 P0-3); the indicator now agrees instead of
  // contradicting.
  const saveStatus: SaveStatus = autoSavePaused
    ? "paused"
    : saveError
      ? "failed"
      : saveInFlight
        ? "saving"
        : isDirty
          ? "unsaved"
          : "saved";

  // Iter-22 (user feedback) — indicator is HIDDEN until the user has
  // made at least one edit. A freshly-opened file has nothing
  // meaningful to say + visually overlaps Excalidraw's library
  // sidebar. Reset on `filePath` change so opening another tab/file
  // re-arms the silence-on-mount behaviour.
  //
  // Pure-useState "derive state from props" pattern: track previous
  // values in their own useState slots and adjust dependent state
  // synchronously during render. This is the React 19 canonical
  // pattern (react.dev "you might not need an effect"); avoids both
  // setState-in-effect (lint: react-hooks/no-direct-set-state-in-use-effect)
  // AND ref-reads during render (lint: react-hooks/refs-in-render).
  const [hasEverBeenDirty, setHasEverBeenDirty] = useState(false);
  const [trackedFilePath, setTrackedFilePath] = useState(filePath);
  if (trackedFilePath !== filePath) {
    setTrackedFilePath(filePath);
    if (hasEverBeenDirty) setHasEverBeenDirty(false);
  }
  if (isDirty && !hasEverBeenDirty) {
    setHasEverBeenDirty(true);
  }

  // Iter-22 (user feedback) — auto-fade 2 s after entering the saved
  // state. The indicator collapses to opacity 0 (`data-hidden="true"`)
  // and stays hidden until the next edit re-arms it. Failed and
  // paused states do NOT fade — they signal the user must act, so
  // silently hiding them would be a regression of the iter-21 P0-3
  // affordance gap. The "saving" state also does not fade; it
  // transitions to "saved" naturally when the IPC resolves.
  //
  // Reset path uses the derive-state-from-props pattern; the 2 s
  // timer is the only setState call inside an effect, and it is
  // ASYNCHRONOUS (inside the setTimeout callback) — which the lint
  // rule allows.
  const [savedHideTimerExpired, setSavedHideTimerExpired] = useState(false);
  const [trackedSaveStatus, setTrackedSaveStatus] = useState(saveStatus);
  if (trackedSaveStatus !== saveStatus) {
    setTrackedSaveStatus(saveStatus);
    if (savedHideTimerExpired) setSavedHideTimerExpired(false);
  }
  useEffect(() => {
    if (saveStatus !== "saved") return;
    const timer = window.setTimeout(() => {
      setSavedHideTimerExpired(true);
    }, 2000);
    return () => {
      window.clearTimeout(timer);
    };
  }, [saveStatus]);

  // Indicator is hidden when:
  //   - the user has not edited yet (just opened the file), OR
  //   - we are in the saved state and 2 s have elapsed.
  // The DOM element stays mounted (so screen-reader `aria-live`
  // announcements still fire on state changes); CSS opacity drops to
  // 0 via `data-hidden="true"`.
  const indicatorHidden =
    !hasEverBeenDirty ||
    (saveStatus === "saved" && savedHideTimerExpired);

  // Iter-21 (#352 P0-1) — seed the autosave hook's library baseline
  // from the just-loaded scene BEFORE Excalidraw fires its first
  // `onLibraryChange`. For canonical `.excalidrawlib` files, scene
  // load populates `scene.libraryItems`; without this seed, the
  // first user library mutation would be auto-baselined (via the
  // `lastSavedHashRef.current === null` branch in `notifyChange`)
  // and silently lost. For non-library files, items default to `[]`
  // so the ref is always non-null at save time. Effect re-runs on
  // `reloadKey` so the conflict-banner Reload path also re-seeds.
  useEffect(() => {
    if (!scene) return;
    setBaselineLibrary(scene.libraryItems ?? []);
  }, [scene, setBaselineLibrary, reloadKey]);

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

  // Iter-22 (#352 product-expert iter-21 P0) — line-anchored
  // comments warning. Query the MRSF sidecar for the file's
  // unresolved line-anchored count whenever the user enters Editor
  // mode. If > 0 AND the user has not already dismissed for this
  // path in this session, show the warning banner above the canvas.
  // The FirstEntryBanner shows ONCE per profile and does not warn
  // about the file the user is actually about to edit; this banner
  // closes that gap with a count + per-file dismissal.
  //
  // Uses the existing `getFileBadges` IPC: `count - file_level_count`
  // = unresolved threads anchored to specific lines. No new IPC.
  //
  // The reset-to-zero on non-editor mode flows through the IPC
  // promise resolution (which sees mode change) rather than a
  // synchronous setState inside the effect body — react-hooks
  // `set-state-in-effect` lint rejects synchronous setState in
  // effects. Instead the effect short-circuits without setting; a
  // separate state reset follows the user-driven `setLineAnchored`
  // when the IPC's cancelled flag flips.
  const [lineAnchoredCount, setLineAnchoredCount] = useState(0);
  useEffect(() => {
    let cancelled = false;
    if (mode !== "editor") {
      // Defer the reset to the next microtask so we are not setting
      // state synchronously inside the effect body.
      Promise.resolve().then(() => {
        if (!cancelled) setLineAnchoredCount(0);
      });
      return () => {
        cancelled = true;
      };
    }
    void getFileBadges([filePath])
      .then((badges) => {
        if (cancelled) return;
        const badge = badges[filePath];
        if (!badge) {
          setLineAnchoredCount(0);
          return;
        }
        const lineAnchored = Math.max(
          0,
          (badge.count ?? 0) - (badge.file_level_count ?? 0),
        );
        setLineAnchoredCount(lineAnchored);
      })
      .catch((err: unknown) => {
        // Best-effort: if badge query fails the banner stays hidden.
        // The user is informed once per profile via FirstEntryBanner;
        // a missed per-file warning is acceptable, an erroneous one
        // is not.
        void logWarn(
          `[excalidraw] line-anchored badge query failed for ${filePath}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      });
    return () => {
      cancelled = true;
    };
  }, [mode, filePath]);

  const lineAnchoredBannerVisible =
    mode === "editor" &&
    lineAnchoredCount > 0 &&
    !lineAnchoredDismissedThisSession.has(filePath);

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
      {mode === "editor" && !savedPillVisible && (
        <SaveStatusIndicator status={saveStatus} hidden={indicatorHidden} />
      )}
      {mode === "editor" && firstEntryBannerVisible && (
        <FirstEntryBanner
          onDismiss={() => {
            FIRST_ENTRY.mark();
            setFirstEntryBannerVisible(false);
          }}
        />
      )}
      {lineAnchoredBannerVisible && (
        <LineAnchoredCommentsBanner
          count={lineAnchoredCount}
          onDismiss={() => {
            lineAnchoredDismissedThisSession.add(filePath);
            // Force re-render so the visibility flag flips. Setting
            // count to 0 doubles as the flag's source-of-truth; the
            // dismissed-set is checked anyway, but the flag flip
            // makes the synchronous re-render obvious.
            setLineAnchoredCount(0);
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
            // Iter-21 (#352 P0-2) — split reload trigger by file
            // class to eliminate the stale-content remount race.
            //
            //   - Canonical `.excalidraw` / `.excalidrawlib`: the
            //     reload chain is dirty-clear → synthetic
            //     `mdownreview:file-changed` → `useFileContent`
            //     re-fetches → `content` prop changes →
            //     `useExcalidrawScene` re-parses → `loadVersion`
            //     increments → `<Excalidraw key={loadVersion}>`
            //     remounts with new initialData. Bumping a local
            //     `reloadKey` here would re-fire
            //     `useExcalidrawScene`'s effect SYNCHRONOUSLY with
            //     the OLD `content`, remounting Excalidraw with
            //     stale data BEFORE the async re-read commits.
            //     The next user edit then autosaves the stale
            //     draft over the external version (silent data
            //     loss — bug-expert P0-2). DO NOT bump.
            //   - Binary `.excalidraw.png` / `.excalidraw.svg`:
            //     `content` is sentinel-empty so it never changes;
            //     the reloadKey bump is the only way to re-fire
            //     `extractScene`. The async extract then commits a
            //     fresh scene + bumps `loadVersion` → remount.
            //
            // Iter-12 bug #3 — Reload no-op for canonical files —
            // still applies: clear `excalidrawDirty` BEFORE the
            // dispatch so the listener takes the non-conflict
            // branch. Reset the autosave baseline too so the
            // post-reload first onChange re-baselines.
            useStore.getState().setExcalidrawDirty(filePath, false);
            resetBaseline();
            useStore.getState().setExternalChangePending(filePath, false);
            if (needsExtract) {
              setReloadKey((k) => k + 1);
            }
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
          key={loadVersion}
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
            // Iter-21 (#352 P0-1) — DO NOT read `appState.libraryItems`
            // here. Excalidraw's `onChange` payload does not carry
            // library state; that flows through `onLibraryChange` and
            // is captured into the autosave hook's
            // `liveLibraryItemsRef` separately. The previous reading
            // here always resolved to `null` and silently wrote
            // empty libraries on every `.excalidrawlib` save.
            notifyChange({
              elements: elements as ReadonlyArray<unknown>,
              appState: appState as unknown as Record<string, unknown>,
              files: files as unknown as Record<string, unknown>,
            });
          }}
          onLibraryChange={(libraryItems) => {
            // Iter-21 (#352 P0-1) — single source of truth for
            // library state. Excalidraw fires this synchronously
            // when the user adds / removes / publishes / unpublishes
            // a library item, and on `<Excalidraw initialData>`
            // bootstrap. The autosave hook merges these into the
            // save payload + the dirty-tracking hash.
            notifyLibraryChange(libraryItems as ReadonlyArray<unknown>);
          }}
        />
      </div>
    </div>
  );
}
