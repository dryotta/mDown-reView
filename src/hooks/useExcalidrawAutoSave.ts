import { useCallback, useEffect, useRef, useState } from "react";

import { friendlySaveError } from "@/lib/excalidraw/error-mapping";
import type { ExcalidrawScene } from "@/lib/excalidraw/extractScene";
import { registerExcalidrawFlush } from "@/lib/excalidraw/flush-registry";
import { saveExcalidrawFile } from "@/lib/excalidraw/saveScene";
import { computeSceneSnapshot } from "@/lib/excalidraw/stable-hash";
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
  flush: () => void;
  resetBaseline: () => void;
  saveError: string | null;
  clearSaveError: () => void;
  autoSavePaused: boolean;
  retryAfterFailure: () => void;
  savedPillVisible: boolean;
  triggerSavedPill: () => void;
}

export function useExcalidrawAutoSave(
  filePath: string,
  mode: "visual" | "editor",
  externalChangePending: boolean,
): AutoSaveState {
  const [saveError, setSaveError] = useState<string | null>(null);
  const [autoSavePaused, setAutoSavePaused] = useState(false);
  const [savedPillVisible, setSavedPillVisible] = useState(false);

  const liveSceneRef = useRef<ExcalidrawScene | null>(null);
  const lastSavedHashRef = useRef<string | null>(null);
  const saveInFlightRef = useRef(false);
  const pendingSaveRef = useRef(false);
  const autoSaveTimerRef = useRef<number | null>(null);
  const failureCountRef = useRef(0);
  const lastSavePromiseRef = useRef<Promise<void> | null>(null);
  const savedPillTimerRef = useRef<number | null>(null);
  const mountedRef = useRef(true);

  const setExcalidrawDirty = useStore((s) => s.setExcalidrawDirty);
  const recordSave = useStore((s) => s.recordSave);

  // Mirror reactive props/state into refs so callbacks invoked outside
  // the current render's closure (timer fires, .finally continuations,
  // window event listeners) read the latest values. `autoSavePaused`
  // was previously read directly from React state in `performSave`,
  // which broke the Retry button (state setter queues the unpause for
  // next render; the same-render `performSave` then bailed at the
  // pause check) — bug-expert HIGH and react-tauri-expert HIGH.
  const modeRef = useRef(mode);
  const externalChangePendingRef = useRef(externalChangePending);
  const autoSavePausedRef = useRef(autoSavePaused);
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);
  useEffect(() => {
    externalChangePendingRef.current = externalChangePending;
  }, [externalChangePending]);
  useEffect(() => {
    autoSavePausedRef.current = autoSavePaused;
  }, [autoSavePaused]);

  const performSave = (bypassModeCheck: boolean): void => {
    if (!mountedRef.current) return;
    if (!bypassModeCheck && modeRef.current !== "editor") return;
    if (autoSavePausedRef.current) {
      // User must explicitly Resume after the failure-pause kicks in.
      // Read via ref so a same-render Retry click that flips state
      // sees the new value (`retryAfterFailure` clears the ref before
      // calling performSave).
      return;
    }
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
    const savedHash = liveHash;
    const savePromise = saveExcalidrawFile(filePath, {
      elements: live.elements,
      appState: live.appState,
      files: live.files,
      libraryItems: live.libraryItems ?? null,
    })
      .then(() => {
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
            performSave(false);
          }, 0);
          return;
        }
        const live2 = liveSceneRef.current;
        if (!live2) return;
        void saveExcalidrawFile(filePath, {
          elements: live2.elements,
          appState: live2.appState,
          files: live2.files,
          libraryItems: live2.libraryItems ?? null,
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

  const flush = useCallback((): void => {
    if (autoSaveTimerRef.current !== null) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
    performSave(true);
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
    liveSceneRef.current = live;
    if (modeRef.current !== "editor") return;
    if (lastSavedHashRef.current === null) {
      // First onChange after a load — establish the baseline. Mount-
      // time normalisation onChanges (font load, library merge) all
      // produce the same persisted form because `computeSceneSnapshot`
      // strips the volatile `versionNonce`.
      lastSavedHashRef.current = computeSceneSnapshot(filePath, live);
      return;
    }
    // Hash-compare BEFORE latching dirty=true. Viewport pan / tool
    // selection / cursor moves all fire onChange but produce no
    // persistent-content drift. Without this guard, an external write
    // arriving during the 2 s debounce window would raise the conflict
    // banner even though the live scene matches disk byte-for-byte
    // (bug-expert MEDIUM finding).
    const liveHash = computeSceneSnapshot(filePath, live);
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
      performSave(false);
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
  }, []);

  const clearSaveError = useCallback((): void => setSaveError(null), []);

  const retryAfterFailure = useCallback((): void => {
    failureCountRef.current = 0;
    autoSavePausedRef.current = false;
    setAutoSavePaused(false);
    setSaveError(null);
    performSave(false);
    // performSave reads via refs; deps intentionally empty.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const triggerSavedPill = useCallback((): void => {
    if (savedPillTimerRef.current !== null) {
      clearTimeout(savedPillTimerRef.current);
    }
    setSavedPillVisible(true);
    savedPillTimerRef.current = window.setTimeout(() => {
      savedPillTimerRef.current = null;
      if (mountedRef.current) setSavedPillVisible(false);
    }, EXCALIDRAW_SAVED_PILL_MS);
  }, []);

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
    flush,
    resetBaseline,
    saveError,
    clearSaveError,
    autoSavePaused,
    retryAfterFailure,
    savedPillVisible,
    triggerSavedPill,
  };
}
