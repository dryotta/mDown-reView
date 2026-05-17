import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { act } from "react";
import { useStore } from "@/store";
import { useCrossWindowPrefsSync } from "../useCrossWindowPrefsSync";

/** Fire a synthetic StorageEvent in the current window. */
function fireStorageEvent(key: string | null, newValue: string | null) {
  window.dispatchEvent(
    new StorageEvent("storage", { key, newValue, storageArea: localStorage }),
  );
}

/** Build a well-formed persist payload wrapping the given partial state. */
function payload(state: Record<string, unknown>): string {
  return JSON.stringify({ state, version: 1 });
}

describe("useCrossWindowPrefsSync", () => {
  beforeEach(() => {
    // Reset store to defaults before each test so assertions are stable.
    useStore.setState({
      theme: "system",
      authorName: "",
      readingWidth: 720,
      commentsPaneVisible: true,
      folderPaneWidth: 240,
      updateChannel: "stable",
      recentItems: [],
      zoomByFiletype: {},
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not sync per-window layout state (folderPaneWidth, commentsPaneVisible)", () => {
    useStore.setState({ folderPaneWidth: 240, commentsPaneVisible: true });
    renderHook(() => useCrossWindowPrefsSync());

    act(() => {
      fireStorageEvent(
        "mdownreview-ui",
        payload({ folderPaneWidth: 400, commentsPaneVisible: false }),
      );
    });

    // Per-window layout state must NOT be synced (issue #248)
    expect(useStore.getState().folderPaneWidth).toBe(240);
    expect(useStore.getState().commentsPaneVisible).toBe(true);
  });

  it("does not sync showSidecarFiles (per-window preference)", () => {
    useStore.setState({ showSidecarFiles: false });
    renderHook(() => useCrossWindowPrefsSync());

    act(() => {
      fireStorageEvent(
        "mdownreview-ui",
        payload({ showSidecarFiles: true }),
      );
    });

    expect(useStore.getState().showSidecarFiles).toBe(false);
  });

  it("syncs readingWidth across windows", () => {
    useStore.setState({ readingWidth: 720 });
    renderHook(() => useCrossWindowPrefsSync());

    act(() => {
      fireStorageEvent(
        "mdownreview-ui",
        payload({ readingWidth: 1200 }),
      );
    });

    expect(useStore.getState().readingWidth).toBe(1200);
  });

  it("does not sync zoomByFiletype (per-window session-only state)", () => {
    useStore.setState({ zoomByFiletype: {} });
    renderHook(() => useCrossWindowPrefsSync());

    act(() => {
      fireStorageEvent(
        "mdownreview-ui",
        payload({ zoomByFiletype: { ".md": 1.5 } }),
      );
    });

    expect(useStore.getState().zoomByFiletype).toEqual({});
  });

  it("updates global prefs when a storage event fires with the persist key", () => {
    renderHook(() => useCrossWindowPrefsSync());

    act(() => {
      fireStorageEvent(
        "mdownreview-ui",
        payload({ theme: "dark", authorName: "Alice" }),
      );
    });

    expect(useStore.getState().theme).toBe("dark");
    expect(useStore.getState().authorName).toBe("Alice");
  });

  it("cross-window theme change drives the renderer's <html data-theme> via useApplyTheme", async () => {
    // End-to-end propagation: storage event -> useCrossWindowPrefsSync ->
    // Zustand theme update -> any component consuming `theme` (e.g.
    // useApplyTheme inside App.tsx) repaints data-theme. This test
    // composes both hooks so the renderer-side DOM effect is verified,
    // closing the gap test-coverage-r2 NEW-GAP-2 flagged: Zustand was
    // tested in isolation but the load-bearing DOM application was not.
    const { useApplyTheme } = await import("../useApplyTheme");

    // useApplyTheme calls window.matchMedia — jsdom doesn't provide it
    // by default. Install a minimal stub matching the shape used by
    // useApplyTheme.test.ts; the actual systemPrefersDark value
    // doesn't matter here because we drive an explicit "light" then
    // "dark" pref (system-mode resolution is covered by useApplyTheme's
    // own suite).
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      configurable: true,
      value: vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    });

    document.documentElement.removeAttribute("data-theme");
    useStore.setState({ theme: "light" });

    // Render both hooks together — useCrossWindowPrefsSync subscribes
    // to the storage event, useApplyTheme subscribes to the store and
    // mirrors `theme` into `<html data-theme>`.
    const { rerender } = renderHook(
      ({ themePref }: { themePref: "system" | "light" | "dark" }) => {
        useCrossWindowPrefsSync();
        useApplyTheme(themePref);
      },
      { initialProps: { themePref: useStore.getState().theme } },
    );

    // Sanity: initial state.
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");

    // Cross-window storage event flips the store to "dark".
    act(() => {
      fireStorageEvent("mdownreview-ui", payload({ theme: "dark" }));
    });
    expect(useStore.getState().theme).toBe("dark");

    // useApplyTheme is a `useEffect([theme])`-driven hook. App.tsx
    // re-runs it whenever the store theme changes; mirror that by
    // re-rendering with the new pref, then assert the DOM updated.
    rerender({ themePref: useStore.getState().theme });
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("skips setState when incoming values match current state (ping-pong guard)", () => {
    useStore.setState({ theme: "dark", authorName: "Alice" });
    renderHook(() => useCrossWindowPrefsSync());
    const spy = vi.spyOn(useStore, "setState");

    act(() => {
      fireStorageEvent(
        "mdownreview-ui",
        payload({ theme: "dark", authorName: "Alice" }),
      );
    });

    // setState should NOT be called when values haven't changed
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("ignores storage events for unrelated keys", () => {
    renderHook(() => useCrossWindowPrefsSync());

    act(() => {
      fireStorageEvent("other-app", payload({ theme: "dark" }));
    });

    expect(useStore.getState().theme).toBe("system");
  });

  it("ignores storage events with null newValue", () => {
    renderHook(() => useCrossWindowPrefsSync());

    act(() => {
      fireStorageEvent("mdownreview-ui", null);
    });

    expect(useStore.getState().theme).toBe("system");
  });

  it("ignores malformed JSON in newValue", () => {
    renderHook(() => useCrossWindowPrefsSync());

    act(() => {
      fireStorageEvent("mdownreview-ui", "not-json{{{");
    });

    // Store should remain unchanged — no throw.
    expect(useStore.getState().theme).toBe("system");
  });

  it("ignores payloads missing the state wrapper", () => {
    renderHook(() => useCrossWindowPrefsSync());

    act(() => {
      fireStorageEvent("mdownreview-ui", JSON.stringify({ version: 1 }));
    });

    expect(useStore.getState().theme).toBe("system");
  });

  it("does not overwrite keys absent from the incoming state", () => {
    useStore.setState({ authorName: "Bob", readingWidth: 900 });
    renderHook(() => useCrossWindowPrefsSync());

    act(() => {
      // Only theme is in the payload — authorName and readingWidth must survive.
      fireStorageEvent("mdownreview-ui", payload({ theme: "light" }));
    });

    expect(useStore.getState().theme).toBe("light");
    expect(useStore.getState().authorName).toBe("Bob");
    expect(useStore.getState().readingWidth).toBe(900);
  });

  it("does NOT call set_theme IPC when receiving a cross-window theme update", async () => {
    // Follower windows update the in-memory store only; the leader
    // window already wrote `onboarding.json` via the user-action site
    // (`useThemePref().setTheme`). Re-firing `set_theme` here would
    // cause a write storm proportional to the number of open windows
    // and re-introduce the FOUC-fix race PR #363 closed.
    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockClear();

    useStore.setState({ theme: "system" });
    renderHook(() => useCrossWindowPrefsSync());

    act(() => {
      fireStorageEvent("mdownreview-ui", payload({ theme: "dark" }));
    });

    expect(useStore.getState().theme).toBe("dark");
    const setThemeCall = vi
      .mocked(invoke)
      .mock.calls.find((c) => c[0] === "set_theme");
    expect(setThemeCall).toBeUndefined();
  });

  it("removes the event listener on unmount", () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    const removeSpy = vi.spyOn(window, "removeEventListener");

    const { unmount } = renderHook(() => useCrossWindowPrefsSync());

    expect(addSpy).toHaveBeenCalledWith("storage", expect.any(Function));
    const handler = addSpy.mock.calls.find((c) => c[0] === "storage")?.[1];

    unmount();

    expect(removeSpy).toHaveBeenCalledWith("storage", handler);
  });
});
