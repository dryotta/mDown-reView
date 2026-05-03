/**
 * Iter-21 (#352 P0-1) — regression coverage for the silent
 * library-wipe bug discovered post-iter-20 ship-readiness review.
 *
 * Pre-fix design: `useExcalidrawAutoSave` read library items from the
 * `<Excalidraw onChange>` callback's `appState.libraryItems` field.
 * That field does not exist on the scene-tick appState — Excalidraw
 * separates scene state and library state, surfacing the latter via
 * the dedicated `onLibraryChange` callback. The result was that
 * `live.libraryItems` was always `null` and `saveScene.ts` fell
 * through to writing an empty `libraryItems: []`, silently
 * destroying the user's curated `.excalidrawlib` file on every
 * autosave or close-flush.
 *
 * Post-fix design (verified in this file):
 *   - `notifyLibraryChange(items)` is the single ingress for library
 *     state from `<Excalidraw onLibraryChange>`.
 *   - `setBaselineLibrary(items)` seeds the in-memory baseline from
 *     the loaded scene so the FIRST user library mutation is not
 *     auto-baselined and silently lost.
 *   - For `.excalidrawlib` files, library changes mark dirty + arm
 *     the debounce timer (the library IS the file content).
 *   - For non-library files, library state is per-user palette and
 *     does not flag the file dirty.
 *   - At save time the IPC payload's `libraryItems` is sourced from
 *     the dedicated ref, NOT from the scene snapshot.
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  saveExcalidrawFileMock: vi.fn(async (_path: string, _data: unknown) => {}),
  recordSaveMock: vi.fn(),
  setExcalidrawDirtyMock: vi.fn(),
  externalChangePendingState: {} as Record<string, boolean>,
  // Iter-22 (#352 bug-expert iter-21 P0-1): capture registered drain
  // callbacks per file-path so tests can invoke the close-flush
  // handshake directly without spinning up the real registry module.
  registeredFlushes: new Map<string, () => Promise<void>>(),
}));

vi.mock("@/lib/excalidraw/saveScene", () => ({
  saveExcalidrawFile: (path: string, data: unknown) =>
    mocks.saveExcalidrawFileMock(path, data),
}));

vi.mock("@/lib/excalidraw/flush-registry", () => ({
  registerExcalidrawFlush: vi.fn(
    (filePath: string, flush: () => Promise<void>) => {
      mocks.registeredFlushes.set(filePath, flush);
      return () => {
        if (mocks.registeredFlushes.get(filePath) === flush) {
          mocks.registeredFlushes.delete(filePath);
        }
      };
    },
  ),
}));

vi.mock("@/store", () => {
  const fakeState = {
    setExcalidrawDirty: mocks.setExcalidrawDirtyMock,
    recordSave: mocks.recordSaveMock,
    get externalChangePendingByTab() {
      return mocks.externalChangePendingState;
    },
  };
  const useStore = ((sel: (s: typeof fakeState) => unknown) => sel(fakeState)) as unknown as {
    (sel: (s: typeof fakeState) => unknown): unknown;
    getState: () => typeof fakeState;
  };
  useStore.getState = () => fakeState;
  return { useStore };
});

import { useExcalidrawAutoSave } from "../useExcalidrawAutoSave";

beforeEach(() => {
  mocks.saveExcalidrawFileMock.mockReset();
  mocks.saveExcalidrawFileMock.mockResolvedValue(undefined);
  mocks.recordSaveMock.mockReset();
  mocks.setExcalidrawDirtyMock.mockReset();
  for (const k of Object.keys(mocks.externalChangePendingState)) {
    delete mocks.externalChangePendingState[k];
  }
  mocks.registeredFlushes.clear();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useExcalidrawAutoSave — library state plumbing (#352 P0-1)", () => {
  it("Cmd+S flush carries libraryItems sourced from notifyLibraryChange (NOT from onChange appState)", async () => {
    const PATH = "/ws/icons.excalidrawlib";
    const items = [
      { id: "lib1", status: "published", elements: [{ id: "e1", type: "rect" }] },
      { id: "lib2", status: "unpublished", elements: [{ id: "e2", type: "ellipse" }] },
    ];
    const { result, unmount } = renderHook(() =>
      useExcalidrawAutoSave(PATH, "editor", false),
    );
    // Bootstrap baseline so the first notifyLibraryChange is not
    // auto-baselined to the post-mutation state.
    act(() => result.current.setBaselineLibrary([]));
    // First scene tick — empty scene baseline.
    act(() =>
      result.current.notifyChange({
        elements: [],
        appState: {},
        files: {},
      }),
    );
    // User adds two items to the library — Excalidraw fires
    // onLibraryChange. The ExcalidrawView callback wires this to
    // notifyLibraryChange.
    act(() => result.current.notifyLibraryChange(items));
    // Cmd+S flush + drain the .then bookkeeping (setSaveError(null)
    // etc.) inside act so React's strict-act assertion is satisfied.
    await act(async () => {
      result.current.flush({ userInitiated: true });
      await Promise.resolve();
    });
    expect(mocks.saveExcalidrawFileMock).toHaveBeenCalledTimes(1);
    const [, payload] = mocks.saveExcalidrawFileMock.mock.calls[0] as [
      string,
      { libraryItems: ReadonlyArray<unknown> },
    ];
    expect(payload.libraryItems).toEqual(items);
    await act(async () => {
      unmount();
    });
  });

  it("autosave debounce carries libraryItems sourced from notifyLibraryChange", async () => {
    const PATH = "/ws/icons.excalidrawlib";
    const items = [{ id: "only", status: "unpublished" }];
    const { result, unmount } = renderHook(() =>
      useExcalidrawAutoSave(PATH, "editor", false),
    );
    act(() => result.current.setBaselineLibrary([]));
    act(() =>
      result.current.notifyChange({
        elements: [],
        appState: {},
        files: {},
      }),
    );
    act(() => result.current.notifyLibraryChange(items));
    // Advance past the 2 s autosave debounce + drain the resolved
    // save's .then bookkeeping inside act.
    await act(async () => {
      vi.advanceTimersByTime(2100);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.saveExcalidrawFileMock).toHaveBeenCalledTimes(1);
    const [, payload] = mocks.saveExcalidrawFileMock.mock.calls[0] as [
      string,
      { libraryItems: ReadonlyArray<unknown> },
    ];
    expect(payload.libraryItems).toEqual(items);
    await act(async () => {
      unmount();
    });
  });

  it("does NOT silently write an empty library when only onChange fires (the iter-20 bug)", async () => {
    // Direct repro of the working-tree evidence from #352 dogfood
    // testing: 226-line library file became 6 lines / empty array.
    // Pre-fix: notifyChange ran → live.libraryItems = null → save
    // payload .libraryItems = null → saveScene fell through to [].
    // Post-fix: liveLibraryItemsRef stays seeded with the baseline,
    // so a Cmd+S with no library mutation writes the loaded items.
    const PATH = "/ws/icons.excalidrawlib";
    const baseline = [{ id: "loaded1" }, { id: "loaded2" }, { id: "loaded3" }];
    const { result, unmount } = renderHook(() =>
      useExcalidrawAutoSave(PATH, "editor", false),
    );
    act(() => result.current.setBaselineLibrary(baseline));
    // Excalidraw normalises the scene on mount; no library mutation.
    act(() =>
      result.current.notifyChange({
        elements: [],
        appState: { gridModeEnabled: true },
        files: {},
      }),
    );
    await act(async () => {
      result.current.flush({ userInitiated: true });
      await Promise.resolve();
    });
    // The cheap pre-filter or hash-equal check may short-circuit
    // because nothing changed since baseline; either way, IF a
    // save fires it MUST carry the original library items.
    if (mocks.saveExcalidrawFileMock.mock.calls.length > 0) {
      const [, payload] = mocks.saveExcalidrawFileMock.mock.calls[0] as [
        string,
        { libraryItems: ReadonlyArray<unknown> },
      ];
      expect(payload.libraryItems).toEqual(baseline);
      expect(payload.libraryItems).not.toEqual([]);
    }
    await act(async () => {
      unmount();
    });
  });

  it("library changes on a non-library file do NOT mark dirty (per-user palette)", async () => {
    const PATH = "/ws/diagram.excalidraw";
    const { result, unmount } = renderHook(() =>
      useExcalidrawAutoSave(PATH, "editor", false),
    );
    act(() => result.current.setBaselineLibrary([]));
    act(() =>
      result.current.notifyChange({
        elements: [],
        appState: {},
        files: {},
      }),
    );
    mocks.setExcalidrawDirtyMock.mockClear();
    // User adds a library item while editing a non-library file.
    act(() =>
      result.current.notifyLibraryChange([{ id: "user-palette-add" }]),
    );
    // No dirty flip for the file (the library is per-user, not part
    // of the file content for canonical .excalidraw / PNG / SVG).
    const dirtyTrueCalls = mocks.setExcalidrawDirtyMock.mock.calls.filter(
      (c) => c[1] === true,
    );
    expect(dirtyTrueCalls).toHaveLength(0);
    await act(async () => {
      unmount();
    });
  });

  it("library mutation on a .excalidrawlib file DOES mark dirty + arm debounce", async () => {
    const PATH = "/ws/icons.excalidrawlib";
    const { result, unmount } = renderHook(() =>
      useExcalidrawAutoSave(PATH, "editor", false),
    );
    act(() => result.current.setBaselineLibrary([{ id: "initial" }]));
    act(() =>
      result.current.notifyChange({
        elements: [],
        appState: {},
        files: {},
      }),
    );
    mocks.setExcalidrawDirtyMock.mockClear();
    act(() => result.current.notifyLibraryChange([{ id: "initial" }, { id: "added" }]));
    // Library is the file content for `.excalidrawlib`; a mutation
    // MUST mark dirty so the conflict-banner gate works and the
    // 2 s debounce arms.
    const dirtyTrueCalls = mocks.setExcalidrawDirtyMock.mock.calls.filter(
      (c) => c[1] === true,
    );
    expect(dirtyTrueCalls.length).toBeGreaterThanOrEqual(1);
    // Drain the still-pending debounce so the unmount cleanup
    // doesn't fire a state-mutating .then outside act.
    await act(async () => {
      vi.advanceTimersByTime(2100);
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      unmount();
    });
  });
});

/**
 * Iter-22 (#352 bug-expert iter-21 P0-1) — close-flush bypasses the
 * 3-strike autosave-pause guard for the user-final write attempt.
 *
 * Pre-fix: a paused `useExcalidrawAutoSave` short-circuited at
 * `if (autoSavePausedRef.current) return;` in `performSave`. The
 * close-flush handshake's `drainPendingSavesAsync` called
 * `flush()` → `performSave(true, false)` and silently no-op'd, dropping
 * every edit made after the pause kicked in. The user could draw for
 * minutes after a transient save error (read-only mount, AV quarantine,
 * ENOSPC) and lose every byte on tab/window close.
 *
 * Post-fix: `drainPendingSavesAsync` calls `flush({bypassPause: true})`,
 * which threads a 3rd `bypassPause` parameter through `performSave`
 * that overrides the pause guard. One last best-effort write attempt
 * fires regardless of pause state; pause is meant to back off
 * automatic retries, not to gate the user-final save.
 */
describe("useExcalidrawAutoSave — close-flush bypasses paused guard (#352 P0-1 iter-22)", () => {
  it("close-flush drain attempts a save even after autosave pause kicks in", async () => {
    const PATH = "/ws/paused.excalidraw";
    // Reject every save → 3 consecutive failures → autosave pauses.
    mocks.saveExcalidrawFileMock.mockReset();
    mocks.saveExcalidrawFileMock.mockRejectedValue(new Error("disk full"));

    const { result, unmount } = renderHook(() =>
      useExcalidrawAutoSave(PATH, "editor", false),
    );

    // Establish baseline.
    act(() =>
      result.current.notifyChange({
        elements: [],
        appState: {},
        files: {},
      }),
    );

    // Three consecutive failures via Cmd+S flush.
    for (let i = 1; i <= 3; i++) {
      act(() =>
        result.current.notifyChange({
          elements: [{ id: `edit-${i}` }],
          appState: {},
          files: {},
        }),
      );
      await act(async () => {
        result.current.flush({ userInitiated: true });
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });
    }
    // Autosave is now paused. Confirm via the public state machine.
    expect(result.current.autoSavePaused).toBe(true);

    // User makes one more edit (the failure may or may not have been
    // the user's fault; UI does not gate input). Pre-fix this edit
    // lives in RAM only — `flush()` in close-flush drains will
    // silently no-op at the pause guard.
    act(() =>
      result.current.notifyChange({
        elements: [{ id: "post-pause-edit" }],
        appState: {},
        files: {},
      }),
    );

    // The disk error is now resolved (caller may have freed disk,
    // re-mounted, etc.). The save mock returns success.
    mocks.saveExcalidrawFileMock.mockReset();
    mocks.saveExcalidrawFileMock.mockResolvedValue(undefined);

    // Switch to real timers — `drainPendingSavesAsync` awaits
    // `setTimeout(r, 0)` between iterations, which never fires under
    // fake timers and would hang the test forever.
    vi.useRealTimers();

    // Trigger the close-flush drain — the path the close-flush
    // handshake takes when the user closes the tab/window/app.
    const drain = mocks.registeredFlushes.get(PATH);
    expect(drain, "drain callback was registered").toBeTruthy();
    await act(async () => {
      await drain!();
    });

    // Post-fix invariant: the close-flush drain MUST fire one save
    // attempt even though autoSavePaused is still true. Without
    // bypassPause threading, this assertion fails — the IPC mock is
    // never called, and the post-pause edit is lost forever.
    expect(mocks.saveExcalidrawFileMock).toHaveBeenCalledTimes(1);
    const [path, payload] = mocks.saveExcalidrawFileMock.mock.calls[0] as [
      string,
      { elements: ReadonlyArray<{ id: string }> },
    ];
    expect(path).toBe(PATH);
    expect(payload.elements[0]?.id).toBe("post-pause-edit");

    await act(async () => {
      unmount();
    });
  });

  it("regular debounced autosave still respects the pause guard (no close-flush bypass)", async () => {
    // Counter-test: the bypass MUST be scoped to the close-flush drain
    // only. A regular notifyChange + 2 s debounce while paused must NOT
    // attempt a save (otherwise we'd loop on the same error every 2 s
    // until the user clicks Resume — UI spam was the very reason the
    // pause exists). Locks the surface area of the bypass.
    const PATH = "/ws/regular-debounce.excalidraw";
    mocks.saveExcalidrawFileMock.mockReset();
    mocks.saveExcalidrawFileMock.mockRejectedValue(new Error("disk full"));

    const { result, unmount } = renderHook(() =>
      useExcalidrawAutoSave(PATH, "editor", false),
    );

    act(() =>
      result.current.notifyChange({
        elements: [],
        appState: {},
        files: {},
      }),
    );

    // Three failures → paused.
    for (let i = 1; i <= 3; i++) {
      act(() =>
        result.current.notifyChange({
          elements: [{ id: `edit-${i}` }],
          appState: {},
          files: {},
        }),
      );
      await act(async () => {
        result.current.flush({ userInitiated: true });
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });
    }
    expect(result.current.autoSavePaused).toBe(true);

    // Reset the mock counter — only post-pause attempts matter for
    // this assertion.
    mocks.saveExcalidrawFileMock.mockClear();

    // Edit + advance past debounce.
    act(() =>
      result.current.notifyChange({
        elements: [{ id: "edit-while-paused" }],
        appState: {},
        files: {},
      }),
    );
    await act(async () => {
      vi.advanceTimersByTime(2100);
      await Promise.resolve();
    });

    // Pause still active; debounced save must NOT fire.
    expect(mocks.saveExcalidrawFileMock).not.toHaveBeenCalled();

    await act(async () => {
      unmount();
    });
  });
});
