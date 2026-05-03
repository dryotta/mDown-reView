import { useCallback, useEffect, useRef, useState } from "react";

import { friendlySaveError } from "@/lib/excalidraw/error-mapping";
import type { ExcalidrawScene } from "@/lib/excalidraw/extractScene";
import { registerExcalidrawFlush } from "@/lib/excalidraw/flush-registry";
import { saveExcalidrawFile } from "@/lib/excalidraw/saveScene";
import { computeSceneSnapshot, PERSISTED_APPSTATE_KEYS } from "@/lib/excalidraw/stable-hash";
import {
  EXCALIDRAW_AUTOSAVE_DEBOUNCE_MS,
  EXCALIDRAW_AUTOSAVE_MAX_CONSECUTIVE_FAILURES,
  EXCALIDRAW_SAVED_PILL_MS,
} from "@/lib/viewer-budgets";
import { error as logError } from "@/logger";
import { useStore } from "@/store";

/**
 * Issue #352 / iter-12 — Excalidraw auto-save state machine.
 *
 * Owns the ref-driven save lifecycle that's too low-frequency for
 * React state but too tightly-coupled for a Zustand slice:
 *   - `liveSceneRef`: latest snapshot from Excalidraw `onChange`.
 *   - `lastSavedHashRef`: divergence baseline (post-mount or
 *     post-save).
 *   - `saveInFlightRef` / `pendingSaveRef`: serialise concurrent save
 *     attempts; coalesce post-flight follow-ups.
 *   - `autoSaveTimerRef`: window.setTimeout id for the debounced save.
 *   - `lastSavePromiseRef`: outermost save Promise — awaited by the
 *     close-flush handshake (`useExcalidrawCloseFlush`).
 *   - `failureCountRef` + `autoSavePaused`: failure-pause loop.
 *
 * Public surface (returned to the caller for JSX integration):
 *   - `notifyChange(live)`: called from Excalidraw `onChange`.
 *     Bootstraps the post-load baseline on first call; otherwise marks
 *     dirty + restarts the debounce timer. Cheap producer per perf
 *     rule 3 in `docs/performance.md` — the heavy
 *     `computeSceneSnapshot` only runs at save-attempt time.
 *   - `flush()`: synchronously triggers `performSave(true)` (Cmd+S
 *     bypass + mode-leave + close-flush handshake).
 *   - `resetBaseline()`: clears `lastSavedHashRef` + `pendingSaveRef`
 *     and cancels the pending debounce. Called by the conflict-banner
 *     Reload click before bumping `reloadKey`.
 *   - `saveError` / `clearSaveError` / `retryAfterFailure`: failure-
 *     banner state.
 *   - `autoSavePaused`: failure-pause flag (sticky banner copy).
 *   - `savedPillVisible` / `triggerSavedPill`: transient "Saved" toast
 *     surfaced on Cmd+S flush success.
 *
 * The hook MUST be mounted while `mode === "editor"`; the parent
 * conditionally mounts it via the standard React idiom of rendering
 * the hook through a child component, OR (as `ExcalidrawView` does)
 * renders unconditionally and gates the registry/event side-effects
 * on the `mode` arg internally. The registry effect skips registration
 * when `mode !== "editor"` so visual-mode tabs don't appear in the
 * close-flush drain.
 *
 * Extracted from `ExcalidrawView.tsx` in iter-12 (architect blocker
 * #1 — file size cap rule 23 in `docs/architecture.md`).
 */
export interface AutoSaveState {
  notifyChange: (live: ExcalidrawScene) => void;
  /**
   * Excalidraw separates scene state (elements / appState / files via
   * `onChange`) from library state (via `onLibraryChange`). The previous
   * design read `appState.libraryItems` inside `onChange` — but that key
   * does not exist on the scene-tick appState payload, so library items
   * were always `null` at save time. For `.excalidrawlib` files the
   * downstream `serializeLibraryAsJSON` then wrote an empty array,
   * silently destroying the user's curated library on every save
   * (#352 bug-expert P0-1). The fix wires `onLibraryChange` through this
   * dedicated callback so library items reach the IPC verbatim.
   *
   * For `.excalidrawlib` files this also marks dirty + restarts the
   * debounce timer (the library IS the file content). For non-library
   * files (canonical `.excalidraw` / PNG / SVG) the live items are
   * tracked but not persisted — Excalidraw's library is a per-user
   * palette, not a per-scene asset.
   */
  notifyLibraryChange: (items: ReadonlyArray<unknown>) => void;
  /**
   * Bootstrap the in-memory library baseline from the loaded scene
   * BEFORE the first `notifyLibraryChange` arrives. Excalidraw is not
   * guaranteed to fire `onLibraryChange` on mount, so without this seed
   * the FIRST user library mutation would be silently treated as the
   * baseline (the existing pipeline auto-baselines on the first
   * snapshot — `lastSavedHashRef.current === null`). Calling this from
   * the scene loader fixes the asymmetry.
   */
  setBaselineLibrary: (items: ReadonlyArray<unknown>) => void;
  /**
   * Synchronously trigger `performSave(true)`. The optional opts.userInitiated
   * flag (Cmd+S only) controls whether a successful write surfaces the
   * transient "Saved" pill — pill must NOT appear when the save was paused,
   * skipped (no diff vs baseline), or otherwise short-circuited (review
   * finding bug-expert P1#1).
   */
  flush: (opts?: { userInitiated?: boolean }) => void;
  /**
   * Drop the on-disk baseline + cancel pending debounce. If a save is
   * currently in flight, it is **voided**: its `.then` continuation skips
   * baseline / dirty / recordSave updates so the conflict-banner Reload path
   * cannot leave the user's pre-Reload draft on disk under our self-write
   * suppression token (review finding bug-expert P1#2).
   */
  resetBaseline: () => void;
  saveError: string | null;
  clearSaveError: () => void;
  autoSavePaused: boolean;
  retryAfterFailure: () => void;
  savedPillVisible: boolean;
  /**
   * Iter-21 (#352 product-expert P0-2) — reactive flag that goes true
   * for the duration of an in-flight `saveExcalidrawFile` IPC. The
   * persistent save-status indicator in the toolbar consumes this to
   * surface a "Saving…" state. Without a persistent indicator the
   * autosave-only design left the user with no on-screen affordance
   * to confirm their last edit had landed on disk; the transient
   * SavedPill flashed only on Cmd+S successes.
   */
  saveInFlight: boolean;
}

export function useExcalidrawAutoSave(
  filePath: string,
  mode: "visual" | "editor",
  // Reactive prop kept for caller ergonomics + render re-trigger
  // semantics (the parent passes the live value so React re-runs the
  // hook when the conflict-banner gate flips). The hook itself reads
  // the canonical value from `useStore.getState()` inside `performSave`
  // to avoid the ref-mirror race against the same-tick "Keep editing"
  // click handler. The argument is intentionally unused inside the
  // body — it is retained for parameter parity and future-proofing.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _externalChangePending: boolean,
): AutoSaveState {
  const [saveError, setSaveError] = useState<string | null>(null);
  const [autoSavePaused, setAutoSavePaused] = useState(false);
  const [savedPillVisible, setSavedPillVisible] = useState(false);
  // Iter-21 (#352 product-expert P0-2) — reactive flag for the
  // persistent save-status indicator. Tracks `saveInFlightRef` but
  // surfaced as React state so the toolbar status pill re-renders
  // when a save starts / completes.
  const [saveInFlight, setSaveInFlight] = useState(false);

  const liveSceneRef = useRef<ExcalidrawScene | null>(null);
  // Iter-21 (#352 bug-expert P0-1): library items live on a separate
  // ref because Excalidraw fires them via `onLibraryChange`, NOT
  // through the scene `onChange` callback. Keeping them out of
  // `liveSceneRef` would still be correct, but co-locating them as
  // a peer ref keeps the save payload assembly in one place.
  const liveLibraryItemsRef = useRef<ReadonlyArray<unknown> | null>(null);
  const lastSavedHashRef = useRef<string | null>(null);
  const saveInFlightRef = useRef(false);
  const pendingSaveRef = useRef(false);
  // Set true by `resetBaseline()` while a save is in flight; the in-flight
  // `.then` checks it and SKIPS lastSavedHashRef/recordSave/setExcalidrawDirty
  // so the Reload path's freshly-loaded scene is not silently overwritten by
  // the racing save (review finding bug-expert P1#2).
  const voidInFlightSaveRef = useRef(false);
  const autoSaveTimerRef = useRef<number | null>(null);
  const failureCountRef = useRef(0);
  const lastSavePromiseRef = useRef<Promise<void> | null>(null);
  const savedPillTimerRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
  // Cheap pre-filter ref for `notifyChange`: if Excalidraw passes the same
  // immutable elements array reference AND the persisted appState slice is
  // shallow-equal to the previous tick, no persistent-content change is
  // possible and we skip the heavy `computeSceneSnapshot` (review finding
  // performance-expert HIGH#1 — iter-14 regression).
  const prevElementsArrayRef = useRef<unknown>(null);
  const prevPersistedAppStateRef = useRef<Record<string, unknown> | null>(null);
  const prevLibraryItemsRef = useRef<unknown>(null);

  const setExcalidrawDirty = useStore((s) => s.setExcalidrawDirty);
  const recordSave = useStore((s) => s.recordSave);

  // Single-source-of-truth read for the conflict gate — eliminates the
  // ref-mirror race that previously let a same-tick click handler
  // (Keep editing) flip pending=false and immediately call flush()
  // while the ref still read true.
  const externalChangePending = (path: string): boolean =>
    useStore.getState().externalChangePendingByTab[path] === true;

  // Mirror reactive props/state into refs so callbacks invoked outside
  // the current render's closure (timer fires, .finally continuations,
  // window event listeners) read the latest values. `autoSavePaused`
  // was previously read directly from React state in `performSave`,
  // which broke the Retry button (state setter queues the unpause for
  // next render; the same-render `performSave` then bailed at the
  // pause check) — bug-expert HIGH and react-tauri-expert HIGH.
  //
  // `externalChangePending` is now read directly from `useStore.getState()`
  // inside `performSave` (single source of truth, no ref-mirror race).
  // The ref was vulnerable to the same-tick window between Zustand's
  // synchronous state mutation and React's post-commit ref update —
  // a click handler that flipped pending=false then called flush()
  // would see the stale ref=true and bail. Surfaced by the [B3]
  // regression test (review finding bug-expert suspected #4).
  const modeRef = useRef(mode);
  const autoSavePausedRef = useRef(autoSavePaused);
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);
  useEffect(() => {
    autoSavePausedRef.current = autoSavePaused;
  }, [autoSavePaused]);

  const performSave = (
    bypassModeCheck: boolean,
    userInitiated: boolean = false,
  ): void => {
    if (!mountedRef.current) return;
    if (!bypassModeCheck && modeRef.current !== "editor") return;
    if (autoSavePausedRef.current) {
      // User must explicitly Resume after the failure-pause kicks in.
      // Read via ref so a same-render Retry click that flips state
      // sees the new value (`retryAfterFailure` clears the ref before
      // calling performSave).
      return;
    }
    if (externalChangePending(filePath)) {
      // Conflict banner is up — do not clobber the on-disk version.
      // The user must explicitly resolve via Reload or Keep editing.
      // Read directly from the store (no ref-mirror race — see the
      // ref-declaration comment block above for rationale).
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
    const liveHash = computeSceneSnapshot(filePath, live);
    if (liveHash === lastSavedHashRef.current) {
      // No persistent-content drift since the last save (or the
      // post-mount baseline). Skip the IPC entirely. Also clear dirty
      // here — viewport pan / tool-select onChanges latch dirty=true
      // for the editor session; an external write during that period
      // would spuriously raise the conflict banner even though the
      // live scene matches disk byte-for-byte.
      if (mountedRef.current) setExcalidrawDirty(filePath, false);
      return;
    }
    saveInFlightRef.current = true;
    if (mountedRef.current) setSaveInFlight(true);
    // Reset the void flag for THIS save (each save tracks its own race
    // against `resetBaseline`).
    voidInFlightSaveRef.current = false;
    const savedHash = liveHash;
    const savePromise = saveExcalidrawFile(filePath, {
      elements: live.elements,
      appState: live.appState,
      files: live.files,
      // Iter-21 (#352 P0-1): library items are sourced from the
      // dedicated `liveLibraryItemsRef` (populated by
      // `onLibraryChange` / `setBaselineLibrary`), NOT from the
      // scene snapshot. Excalidraw's `onChange` payload does not
      // carry library state; reading `live.libraryItems` (whose
      // upstream was `appState.libraryItems`) silently wrote an
      // empty array on every `.excalidrawlib` save.
      libraryItems: liveLibraryItemsRef.current,
    })
      .then(() => {
        // If `resetBaseline()` was called during the in-flight IPC (the
        // user clicked Reload on the conflict banner), the on-disk
        // version may now be the EXTERNAL one — overwriting our
        // baseline / dirty / self-write-suppression with the racing
        // save's outcome would silently lose that external version
        // (review finding bug-expert P1#2). Skip the post-success
        // bookkeeping; the Reload path handles re-reading disk.
        if (voidInFlightSaveRef.current) {
          voidInFlightSaveRef.current = false;
          return;
        }
        // Update the on-disk baseline so the next divergence check
        // sees the just-saved scene as canonical.
        lastSavedHashRef.current = savedHash;
        // Reset the failure counter on success.
        failureCountRef.current = 0;
        // `recordSave` MUST run unconditionally (Zustand mutation is
        // safe post-unmount). Previously gated behind `mountedRef`,
        // which meant a tab-switch mid-save left the watcher echo
        // unsuppressed (iter-12 bug-expert finding HIGH#5).
        recordSave(filePath);
        // Pill is gated on userInitiated because the only externally-
        // visible save signal is Cmd+S — debounced auto-saves are
        // intentionally silent (review finding bug-expert P1#1: pill
        // must NOT flash when paused / skipped / no-diff).
        if (userInitiated && mountedRef.current) {
          showSavedPill();
        }
        if (!mountedRef.current) return;
        setSaveError(null);
        setExcalidrawDirty(filePath, false);
      })
      .catch((err: unknown) => {
        // `friendlySaveError` accepts the raw error: a typed
        // `WorkspaceWriteError` (preferred — surfaces via `kind`
        // discriminator) or a fallback Error/string. Logging stays on
        // the raw shape for debugging.
        const logMsg =
          err instanceof Error
            ? err.message
            : typeof err === "object" && err !== null
              ? JSON.stringify(err)
              : String(err);
        void logError(`excalidraw auto-save failed for ${filePath}: ${logMsg}`);
        failureCountRef.current += 1;
        // Clear any racing void flag — a failed save did not write to
        // disk so there's no stale baseline to worry about.
        voidInFlightSaveRef.current = false;
        if (!mountedRef.current) return;
        setSaveError(friendlySaveError(err));
        if (failureCountRef.current >= EXCALIDRAW_AUTOSAVE_MAX_CONSECUTIVE_FAILURES) {
          // Update ref synchronously so a `.finally` drain that fires
          // before React commits the state setter respects the pause.
          autoSavePausedRef.current = true;
          setAutoSavePaused(true);
        }
      })
      .finally(() => {
        saveInFlightRef.current = false;
        if (mountedRef.current) setSaveInFlight(false);
        // Pending follow-up drain: if a fresh onChange queued
        // `pendingSaveRef` while the IPC was in flight, schedule a
        // follow-up. Crucially, drain even after unmount via fire-
        // and-forget so a tab-switch / window-close mid-save doesn't
        // discard the user's latest edit (iter-12 bug-expert
        // finding CRITICAL#2).
        if (!pendingSaveRef.current) return;
        pendingSaveRef.current = false;
        if (mountedRef.current) {
          autoSaveTimerRef.current = window.setTimeout(() => {
            autoSaveTimerRef.current = null;
            performSave(false, false);
          }, 0);
          return;
        }
        const live2 = liveSceneRef.current;
        if (!live2) return;
        void saveExcalidrawFile(filePath, {
          elements: live2.elements,
          appState: live2.appState,
          files: live2.files,
          // Iter-21 (#352 P0-1): post-unmount drain reads library
          // from the dedicated ref. See the matching comment in the
          // primary save payload above.
          libraryItems: liveLibraryItemsRef.current,
        })
          .then(() => {
            useStore.getState().recordSave(filePath);
          })
          .catch((err: unknown) => {
            void logError(
              `excalidraw post-unmount save failed for ${filePath}: ${
                err instanceof Error ? err.message : String(err)
              }`,
            );
          });
      });
    // Surface the outermost save promise so the close-flush hook can
    // await it before signalling Rust the window is safe to close.
    lastSavePromiseRef.current = savePromise;
  };

  const flush = useCallback((opts?: { userInitiated?: boolean }): void => {
    if (autoSaveTimerRef.current !== null) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
    performSave(true, opts?.userInitiated === true);
    // performSave is a stable hook-body closure that reads via refs; deps
    // intentionally empty so the returned function identity is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mirror flush into a ref so unmount/mode-leave effects can call it
  // without re-firing on every render.
  const flushRef = useRef(flush);
  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);

  // Awaitable drain for the close-flush handshake. Resolves only once
  // the dispatched IPC has settled. Capped at 5 iterations to defend
  // against a runaway pendingSave chain in a buggy state.
  const drainPendingSavesAsync = async (): Promise<void> => {
    flushRef.current();
    for (let i = 0; i < 5; i++) {
      if (!saveInFlightRef.current && !pendingSaveRef.current) break;
      const inflight = lastSavePromiseRef.current;
      if (inflight) {
        await inflight.catch(() => {});
      }
      await new Promise<void>((r) => setTimeout(r, 0));
    }
  };

  // Register with the close-flush registry while we're an active editor.
  useEffect(() => {
    if (mode !== "editor") return;
    const unregister = registerExcalidrawFlush(filePath, drainPendingSavesAsync);
    return unregister;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath, mode]);

  // Mount tracker + cleanup. On unmount we FLUSH (not cancel) the
  // pending debounce so a tab switch within
  // EXCALIDRAW_AUTOSAVE_DEBOUNCE_MS doesn't lose the user's edits.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      flushRef.current();
      mountedRef.current = false;
    };
  }, []);

  // Flush on EDITOR-LEAVE: the user clicked Source/Visual on a tab they
  // were editing. Without this, the in-flight debounce fires
  // post-mode-change with mode!=="editor" and bails — losing the edit.
  const wasEditorRef = useRef(mode === "editor");
  useEffect(() => {
    const wasEditor = wasEditorRef.current;
    wasEditorRef.current = mode === "editor";
    if (wasEditor && mode !== "editor") {
      flushRef.current();
    }
  }, [mode]);

  // Reset baseline on file-source changes (filePath / mode change to
  // editor). Caller resets explicitly via `resetBaseline` for the
  // conflict-banner Reload path.
  useEffect(() => {
    lastSavedHashRef.current = null;
  }, [filePath, mode]);

  const notifyChange = useCallback((live: ExcalidrawScene): void => {
    // Iter-21 (#352 P0-1): always source `libraryItems` from the
    // dedicated ref. Excalidraw's `onChange` payload does NOT carry
    // library state — those flow through `onLibraryChange` and are
    // captured into `liveLibraryItemsRef` separately. Without this
    // merge the live snapshot's `libraryItems` would always be `null`
    // (the previous `appState.libraryItems` read was a phantom).
    const merged: ExcalidrawScene = {
      ...live,
      libraryItems: liveLibraryItemsRef.current,
    };
    liveSceneRef.current = merged;
    if (modeRef.current !== "editor") return;

    // Cheap pre-filter (review finding performance-expert HIGH#1):
    // Excalidraw's onChange fires at 60 Hz during freehand drag. The
    // full `computeSceneSnapshot` (O(elements + libraryItems × inner)
    // with JSON.stringify) is too expensive for the hot path. If the
    // elements ARRAY reference, libraryItems ARRAY reference, AND the
    // shallow-equal projection of persisted appState are all identical
    // to the previous tick, no persistent-content change is possible
    // (Excalidraw treats elements as immutable on persistent change —
    // a new array is allocated whenever any element is added /
    // removed / mutated). Bail out without hashing.
    const persistedNow: Record<string, unknown> = {};
    const a = (live.appState ?? {}) as Record<string, unknown>;
    for (const k of PERSISTED_APPSTATE_KEYS) {
      if (k in a) persistedNow[k] = a[k];
    }
    const sameElements = prevElementsArrayRef.current === live.elements;
    const sameLib = prevLibraryItemsRef.current === merged.libraryItems;
    const prevPersisted = prevPersistedAppStateRef.current;
    const samePersisted =
      prevPersisted !== null &&
      Object.keys(persistedNow).length === Object.keys(prevPersisted).length &&
      Object.entries(persistedNow).every(([k, v]) => prevPersisted[k] === v);
    if (lastSavedHashRef.current !== null && sameElements && sameLib && samePersisted) {
      // Pure cursor / pointer / viewport-pan / tool-select onChange.
      // No hash, no re-baseline, no dirty flip. Hot-path exit.
      return;
    }
    prevElementsArrayRef.current = live.elements;
    prevLibraryItemsRef.current = merged.libraryItems;
    prevPersistedAppStateRef.current = persistedNow;

    if (lastSavedHashRef.current === null) {
      // First onChange after a load — establish the baseline. Mount-
      // time normalisation onChanges (font load, library merge) all
      // produce the same persisted form because `computeSceneSnapshot`
      // strips the volatile `versionNonce`.
      lastSavedHashRef.current = computeSceneSnapshot(filePath, merged);
      return;
    }
    // Hash-compare BEFORE latching dirty=true. Viewport pan / tool
    // selection / cursor moves all fire onChange but produce no
    // persistent-content drift. Without this guard, an external write
    // arriving during the 2 s debounce window would raise the conflict
    // banner even though the live scene matches disk byte-for-byte
    // (bug-expert MEDIUM finding).
    const liveHash = computeSceneSnapshot(filePath, merged);
    if (liveHash === lastSavedHashRef.current) {
      // No persistent drift — clear any stale dirty flag so the
      // conflict-banner gate stays accurate.
      setExcalidrawDirty(filePath, false);
      if (autoSaveTimerRef.current !== null) {
        clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
      return;
    }
    setExcalidrawDirty(filePath, true);
    if (autoSaveTimerRef.current !== null) {
      clearTimeout(autoSaveTimerRef.current);
    }
    autoSaveTimerRef.current = window.setTimeout(() => {
      autoSaveTimerRef.current = null;
      performSave(false, false);
    }, EXCALIDRAW_AUTOSAVE_DEBOUNCE_MS);
    // performSave is hook-body and reads via refs; the only reactive
    // captures here (filePath, setExcalidrawDirty) are listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath, setExcalidrawDirty]);

  const resetBaseline = useCallback((): void => {
    if (autoSaveTimerRef.current !== null) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
    pendingSaveRef.current = false;
    lastSavedHashRef.current = null;
    // Reset the cheap pre-filter refs so the next onChange after Reload
    // re-baselines correctly (Excalidraw will mount a fresh scene with
    // a fresh elements array reference; this also covers the case
    // where the same canvas is re-keyed to load disk bytes).
    prevElementsArrayRef.current = null;
    prevPersistedAppStateRef.current = null;
    prevLibraryItemsRef.current = null;
    // If a save is currently in flight, MARK it void so its `.then`
    // skips baseline / dirty / recordSave updates. Without this, the
    // racing save's success handler would write the user's pre-Reload
    // draft as the new baseline AND register a self-write suppression
    // token — silently overwriting the external version the user
    // meant to load (review finding bug-expert P1#2).
    if (saveInFlightRef.current) {
      voidInFlightSaveRef.current = true;
    }
  }, []);

  const clearSaveError = useCallback((): void => setSaveError(null), []);

  /**
   * Iter-21 (#352 P0-1) — wire-through for Excalidraw's
   * `onLibraryChange` event. Updates `liveLibraryItemsRef` (sole source
   * of truth for save payload + hash) and, for `.excalidrawlib` files,
   * re-runs the dirty/debounce pipeline by re-invoking `notifyChange`
   * with the previous scene shape. The new library items are merged
   * into the next `notifyChange` snapshot via `liveLibraryItemsRef`.
   *
   * For non-library files (canonical `.excalidraw` / PNG / SVG)
   * library state is per-user palette, not file content — the ref is
   * updated for consistency but no dirty flag is raised.
   */
  const notifyLibraryChange = useCallback(
    (items: ReadonlyArray<unknown>): void => {
      liveLibraryItemsRef.current = items;
      if (!filePath.toLowerCase().endsWith(".excalidrawlib")) return;
      const prev = liveSceneRef.current;
      // Synthesize a `notifyChange` call carrying the previous scene's
      // elements/appState/files. `notifyChange` will re-merge
      // `liveLibraryItemsRef.current` (now the new items) and run the
      // dirty/debounce pipeline.
      notifyChange({
        elements: prev?.elements ?? [],
        appState: prev?.appState ?? {},
        files: prev?.files ?? {},
      });
    },
    [filePath, notifyChange],
  );

  /**
   * Iter-21 (#352 P0-1) — bootstrap the in-memory library baseline
   * from the loaded scene BEFORE Excalidraw fires its first
   * `onLibraryChange`. Without this seed the FIRST user library
   * mutation would auto-baseline the post-mutation state (via
   * `lastSavedHashRef.current === null` in `notifyChange`), silently
   * losing the user's change. Called by `ExcalidrawView` once per
   * scene-load.
   */
  const setBaselineLibrary = useCallback(
    (items: ReadonlyArray<unknown>): void => {
      liveLibraryItemsRef.current = items;
    },
    [],
  );

  const retryAfterFailure = useCallback((): void => {
    failureCountRef.current = 0;
    autoSavePausedRef.current = false;
    setAutoSavePaused(false);
    setSaveError(null);
    performSave(false, false);
    // performSave reads via refs; deps intentionally empty.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Internal: surface the transient "Saved" pill. Called only from the
   * save success `.then` when the save was user-initiated (Cmd+S) AND a
   * write actually fired. The previously-public `triggerSavedPill` was
   * removed so callers cannot bypass the success gate (review finding
   * bug-expert P1#1: pill must NOT flash when paused / skipped /
   * no-diff).
   */
  function showSavedPill(): void {
    if (savedPillTimerRef.current !== null) {
      clearTimeout(savedPillTimerRef.current);
    }
    setSavedPillVisible(true);
    savedPillTimerRef.current = window.setTimeout(() => {
      savedPillTimerRef.current = null;
      if (mountedRef.current) setSavedPillVisible(false);
    }, EXCALIDRAW_SAVED_PILL_MS);
  }

  // Cleanup any pill timer on unmount.
  useEffect(() => {
    return () => {
      if (savedPillTimerRef.current !== null) {
        clearTimeout(savedPillTimerRef.current);
        savedPillTimerRef.current = null;
      }
    };
  }, []);

  return {
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
  };
}
