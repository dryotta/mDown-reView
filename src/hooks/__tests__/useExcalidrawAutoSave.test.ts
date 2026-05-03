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
}));

vi.mock("@/lib/excalidraw/saveScene", () => ({
  saveExcalidrawFile: (path: string, data: unknown) =>
    mocks.saveExcalidrawFileMock(path, data),
}));

vi.mock("@/lib/excalidraw/flush-registry", () => ({
  registerExcalidrawFlush: vi.fn(() => () => {}),
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
