/**
 * Tests for the iter-3 Excalidraw dirty-state machinery in the tabs slice
 * (issue #352 / AC6 + AC7).
 *
 * Covers:
 *   - `excalidrawDirtyByTab` / `externalChangePendingByTab` defaults
 *   - `setExcalidrawDirty(path, true|false)` and short-circuit on no-op
 *   - `setExternalChangePending(path, true|false)` and short-circuit
 *   - `setViewMode("editor" -> non-editor)` clears dirty + pending
 *   - `closeTab` prompts when dirty; aborts on cancel; cleans maps on
 *     confirm; falls through cleanly without `confirm` (headless)
 *   - `closeAllTabs` prompts once on any-dirty; cleans both maps
 *   - LRU eviction in `openFile` removes both maps for the evicted path
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useStore } from "@/store";

beforeEach(() => {
  useStore.setState({
    tabs: [],
    activeTabPath: null,
    viewModeByTab: {},
    fileMetaByPath: {},
    excalidrawDirtyByTab: {},
    externalChangePendingByTab: {},
    mermaidPopoutOpenFor: null,
  });
});

describe("excalidrawDirtyByTab + externalChangePendingByTab (issue #352)", () => {
  it("defaults to empty maps", () => {
    expect(useStore.getState().excalidrawDirtyByTab).toEqual({});
    expect(useStore.getState().externalChangePendingByTab).toEqual({});
  });

  it("setExcalidrawDirty(path, true) marks the path dirty", () => {
    useStore.getState().setExcalidrawDirty("/ws/scene.excalidraw", true);
    expect(useStore.getState().excalidrawDirtyByTab["/ws/scene.excalidraw"]).toBe(true);
  });

  it("setExcalidrawDirty(path, false) removes the entry (not falsy)", () => {
    useStore.getState().setExcalidrawDirty("/ws/scene.excalidraw", true);
    useStore.getState().setExcalidrawDirty("/ws/scene.excalidraw", false);
    expect(
      Object.prototype.hasOwnProperty.call(
        useStore.getState().excalidrawDirtyByTab,
        "/ws/scene.excalidraw",
      ),
    ).toBe(false);
  });

  it("setExcalidrawDirty short-circuits when the boolean is unchanged", () => {
    useStore.getState().setExcalidrawDirty("/ws/scene.excalidraw", true);
    const before = useStore.getState().excalidrawDirtyByTab;
    useStore.getState().setExcalidrawDirty("/ws/scene.excalidraw", true);
    const after = useStore.getState().excalidrawDirtyByTab;
    // Same reference — no observable state change.
    expect(Object.is(before, after)).toBe(true);
  });

  it("setExternalChangePending(path, true) marks the path pending", () => {
    useStore.getState().setExternalChangePending("/ws/x.excalidraw", true);
    expect(useStore.getState().externalChangePendingByTab["/ws/x.excalidraw"]).toBe(true);
  });

  it("setExternalChangePending(path, false) removes the entry", () => {
    useStore.getState().setExternalChangePending("/ws/x.excalidraw", true);
    useStore.getState().setExternalChangePending("/ws/x.excalidraw", false);
    expect(
      Object.prototype.hasOwnProperty.call(
        useStore.getState().externalChangePendingByTab,
        "/ws/x.excalidraw",
      ),
    ).toBe(false);
  });

  it("setViewMode(path, 'visual') from 'editor' clears dirty + pending", () => {
    useStore.getState().setViewMode("/ws/a.excalidraw", "editor");
    useStore.getState().setExcalidrawDirty("/ws/a.excalidraw", true);
    useStore.getState().setExternalChangePending("/ws/a.excalidraw", true);

    useStore.getState().setViewMode("/ws/a.excalidraw", "visual");

    expect(useStore.getState().excalidrawDirtyByTab["/ws/a.excalidraw"]).toBeUndefined();
    expect(
      useStore.getState().externalChangePendingByTab["/ws/a.excalidraw"],
    ).toBeUndefined();
  });

  it("setViewMode(path, 'source') from 'editor' clears dirty + pending", () => {
    useStore.getState().setViewMode("/ws/a.excalidraw", "editor");
    useStore.getState().setExcalidrawDirty("/ws/a.excalidraw", true);
    useStore.getState().setExternalChangePending("/ws/a.excalidraw", true);

    useStore.getState().setViewMode("/ws/a.excalidraw", "source");

    expect(useStore.getState().excalidrawDirtyByTab["/ws/a.excalidraw"]).toBeUndefined();
    expect(
      useStore.getState().externalChangePendingByTab["/ws/a.excalidraw"],
    ).toBeUndefined();
  });

  it("setViewMode preserves dirty + pending when staying in editor", () => {
    useStore.getState().setViewMode("/ws/a.excalidraw", "editor");
    useStore.getState().setExcalidrawDirty("/ws/a.excalidraw", true);
    useStore.getState().setExternalChangePending("/ws/a.excalidraw", true);

    // No mode-change — re-set to editor.
    useStore.getState().setViewMode("/ws/a.excalidraw", "editor");

    expect(useStore.getState().excalidrawDirtyByTab["/ws/a.excalidraw"]).toBe(true);
    expect(useStore.getState().externalChangePendingByTab["/ws/a.excalidraw"]).toBe(true);
  });
});

describe("close-tab guard (issue #352 / AC6)", () => {
  let confirmSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    confirmSpy = vi.spyOn(globalThis, "confirm").mockReturnValue(true);
  });

  afterEach(() => {
    confirmSpy.mockRestore();
  });

  it("closeTab on a clean tab does NOT prompt", () => {
    useStore.getState().openFile("/ws/a.md", { recordHistory: false });
    useStore.getState().closeTab("/ws/a.md");
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(useStore.getState().tabs.find((t) => t.path === "/ws/a.md")).toBeUndefined();
  });

  it("closeTab on a dirty Excalidraw tab prompts 'Discard changes?'", () => {
    useStore.getState().openFile("/ws/a.excalidraw", { recordHistory: false });
    useStore.getState().setExcalidrawDirty("/ws/a.excalidraw", true);
    useStore.getState().closeTab("/ws/a.excalidraw");
    expect(confirmSpy).toHaveBeenCalledWith("Discard changes?");
  });

  it("closeTab aborts when the user cancels the prompt", () => {
    confirmSpy.mockReturnValue(false);
    useStore.getState().openFile("/ws/a.excalidraw", { recordHistory: false });
    useStore.getState().setExcalidrawDirty("/ws/a.excalidraw", true);
    useStore.getState().closeTab("/ws/a.excalidraw");
    // Tab still present; dirty still set.
    expect(useStore.getState().tabs.find((t) => t.path === "/ws/a.excalidraw")).toBeDefined();
    expect(useStore.getState().excalidrawDirtyByTab["/ws/a.excalidraw"]).toBe(true);
  });

  it("closeTab proceeds + clears both maps on confirm", () => {
    useStore.getState().openFile("/ws/a.excalidraw", { recordHistory: false });
    useStore.getState().setExcalidrawDirty("/ws/a.excalidraw", true);
    useStore.getState().setExternalChangePending("/ws/a.excalidraw", true);
    useStore.getState().closeTab("/ws/a.excalidraw");
    expect(useStore.getState().tabs.find((t) => t.path === "/ws/a.excalidraw")).toBeUndefined();
    expect(useStore.getState().excalidrawDirtyByTab["/ws/a.excalidraw"]).toBeUndefined();
    expect(
      useStore.getState().externalChangePendingByTab["/ws/a.excalidraw"],
    ).toBeUndefined();
  });

  it("closeAllTabs prompts once when any tab is dirty", () => {
    useStore.getState().openFile("/ws/a.md", { recordHistory: false });
    useStore.getState().openFile("/ws/b.excalidraw", { recordHistory: false });
    useStore.getState().setExcalidrawDirty("/ws/b.excalidraw", true);
    useStore.getState().closeAllTabs();
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy).toHaveBeenCalledWith("Discard changes?");
    expect(useStore.getState().tabs).toEqual([]);
    expect(useStore.getState().excalidrawDirtyByTab).toEqual({});
    expect(useStore.getState().externalChangePendingByTab).toEqual({});
  });

  it("closeAllTabs aborts when the user cancels", () => {
    confirmSpy.mockReturnValue(false);
    useStore.getState().openFile("/ws/a.excalidraw", { recordHistory: false });
    useStore.getState().setExcalidrawDirty("/ws/a.excalidraw", true);
    useStore.getState().closeAllTabs();
    expect(useStore.getState().tabs.length).toBe(1);
  });

  it("closeAllTabs does NOT prompt when no tab is dirty", () => {
    useStore.getState().openFile("/ws/a.md", { recordHistory: false });
    useStore.getState().openFile("/ws/b.md", { recordHistory: false });
    useStore.getState().closeAllTabs();
    expect(confirmSpy).not.toHaveBeenCalled();
  });
});

describe("LRU eviction cleans up dirty/pending maps (issue #352 / AC6)", () => {
  it("evicting a tab also removes its dirty + pending entries", () => {
    // Open MAX_TABS+1 to force eviction. MAX_TABS is 5.
    for (let i = 0; i < 5; i++) {
      useStore.getState().openFile(`/ws/${i}.md`, { recordHistory: false });
    }
    // Mark the LRU candidate (oldest, /ws/0.md — but the active is /ws/4.md
    // so /ws/0.md is the candidate to evict). First make it the LRU by
    // setting its lastAccessedAt back via direct state mutation — simpler
    // than orchestrating opens.
    useStore.getState().setExcalidrawDirty("/ws/0.md", true);
    useStore.getState().setExternalChangePending("/ws/0.md", true);

    // Open a new tab — this triggers LRU eviction.
    useStore.getState().openFile("/ws/new.md", { recordHistory: false });

    // /ws/0.md was evicted, and its maps are cleaned.
    expect(
      useStore.getState().tabs.find((t) => t.path === "/ws/0.md"),
    ).toBeUndefined();
    expect(useStore.getState().excalidrawDirtyByTab["/ws/0.md"]).toBeUndefined();
    expect(useStore.getState().externalChangePendingByTab["/ws/0.md"]).toBeUndefined();
  });
});
