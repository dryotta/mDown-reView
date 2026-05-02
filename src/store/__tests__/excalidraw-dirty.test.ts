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
  // iter-5 — `setViewMode` and `setActiveTab` now PROMPT before
  // discarding dirty editor state. The mode-clearing tests below set
  // up dirty state and then trigger the discard, so we need to mock
  // `confirm` to return `true` (user confirms discard) for those
  // assertions; otherwise the guard aborts and dirty state survives.
  let confirmSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    confirmSpy = vi.spyOn(globalThis, "confirm").mockReturnValue(true);
  });
  afterEach(() => {
    confirmSpy.mockRestore();
  });

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

describe("close-tab behaviour (issue #352 / iter-10 — auto-save)", () => {
  // iter-10 redesign: auto-save means there is no longer a "discardable"
  // unsaved state, so close paths NEVER prompt. The dirty map is still
  // maintained for back-compat with components that read it; it is just
  // no longer consulted by close paths.
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

  it("closeTab on a dirty Excalidraw tab does NOT prompt (auto-save)", () => {
    useStore.getState().openFile("/ws/a.excalidraw", { recordHistory: false });
    useStore.getState().setExcalidrawDirty("/ws/a.excalidraw", true);
    useStore.getState().closeTab("/ws/a.excalidraw");
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(
      useStore.getState().tabs.find((t) => t.path === "/ws/a.excalidraw"),
    ).toBeUndefined();
  });

  it("closeTab proceeds + clears both maps", () => {
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

  it("closeAllTabs does NOT prompt even when tabs are dirty (auto-save)", () => {
    useStore.getState().openFile("/ws/a.md", { recordHistory: false });
    useStore.getState().openFile("/ws/b.excalidraw", { recordHistory: false });
    useStore.getState().setExcalidrawDirty("/ws/b.excalidraw", true);
    useStore.getState().closeAllTabs();
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(useStore.getState().tabs).toEqual([]);
    expect(useStore.getState().excalidrawDirtyByTab).toEqual({});
    expect(useStore.getState().externalChangePendingByTab).toEqual({});
  });

  it("closeAllTabs does NOT prompt when no tab is dirty", () => {
    useStore.getState().openFile("/ws/a.md", { recordHistory: false });
    useStore.getState().openFile("/ws/b.md", { recordHistory: false });
    useStore.getState().closeAllTabs();
    expect(confirmSpy).not.toHaveBeenCalled();
  });
});

describe("setActiveTab + setViewMode behaviour (issue #352 / iter-10)", () => {
  // iter-10 redesign: tab switches and mode switches no longer prompt
  // on dirty editors. Auto-save flushes pending edits before the
  // unmount; no user confirmation is required. Leaving editor mode
  // still clears dirty/pending so a later return doesn't see stale
  // flags from a previous session.
  let confirmSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    confirmSpy = vi.spyOn(globalThis, "confirm").mockReturnValue(true);
  });
  afterEach(() => {
    confirmSpy.mockRestore();
  });

  it("does NOT prompt when leaving a clean tab", () => {
    useStore.getState().openFile("/ws/a.excalidraw", { recordHistory: false });
    useStore.getState().openFile("/ws/b.md", { recordHistory: false });
    useStore.getState().setActiveTab("/ws/a.excalidraw", { recordHistory: false });
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it("does NOT prompt when leaving a dirty Excalidraw editor tab (auto-save)", () => {
    useStore.getState().openFile("/ws/a.excalidraw", { recordHistory: false });
    useStore.getState().openFile("/ws/b.md", { recordHistory: false });
    useStore.setState({
      activeTabPath: "/ws/a.excalidraw",
      viewModeByTab: { "/ws/a.excalidraw": "editor" },
    });
    useStore.getState().setExcalidrawDirty("/ws/a.excalidraw", true);
    useStore.getState().setActiveTab("/ws/b.md", { recordHistory: false });
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(useStore.getState().activeTabPath).toBe("/ws/b.md");
  });

  it("setViewMode out of editor does NOT prompt (auto-save) and clears dirty/pending", () => {
    useStore.getState().openFile("/ws/a.excalidraw", { recordHistory: false });
    useStore.getState().setViewMode("/ws/a.excalidraw", "editor");
    useStore.getState().setExcalidrawDirty("/ws/a.excalidraw", true);
    useStore.getState().setExternalChangePending("/ws/a.excalidraw", true);
    useStore.getState().setViewMode("/ws/a.excalidraw", "visual");
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(useStore.getState().viewModeByTab["/ws/a.excalidraw"]).toBe("visual");
    expect(useStore.getState().excalidrawDirtyByTab["/ws/a.excalidraw"]).toBeUndefined();
    expect(
      useStore.getState().externalChangePendingByTab["/ws/a.excalidraw"],
    ).toBeUndefined();
  });
});

// (iter-5 BLOCKER guard tests for setActiveTab/setViewMode were removed
// when iter-10 replaced explicit-save with autosave; the corresponding
// dirty-prompt logic is gone. See "setActiveTab + setViewMode behaviour"
// suite above for the autosave-era assertions.)

describe("LRU eviction (issue #352 / iter-11)", () => {
  // iter-11 redesign: with auto-save, evicted tabs already have their
  // content on disk. The previous "exempt dirty Excalidraw editors
  // from MAX_TABS eviction" carve-out is gone — the cap applies
  // uniformly. This suite asserts the simplified eviction.
  it("evicting a clean tab silently cleans its (empty) maps", () => {
    // Open MAX_TABS+1 to force eviction. MAX_TABS is 5.
    for (let i = 0; i < 5; i++) {
      useStore.getState().openFile(`/ws/${i}.md`, { recordHistory: false });
    }
    // Open a new tab — this triggers LRU eviction of /ws/0.md (oldest).
    useStore.getState().openFile("/ws/new.md", { recordHistory: false });
    expect(
      useStore.getState().tabs.find((t) => t.path === "/ws/0.md"),
    ).toBeUndefined();
    expect(useStore.getState().tabs.length).toBe(5);
  });

  it("evicts the oldest non-active tab regardless of dirty flag (auto-save handles persistence)", () => {
    for (let i = 0; i < 5; i++) {
      useStore.getState().openFile(`/ws/${i}.md`, { recordHistory: false });
    }
    // /ws/0.md is the oldest. Mark it dirty (legacy concept — the
    // map still exists for the conflict-banner gate, but no longer
    // exempts the tab from eviction).
    useStore.getState().setExcalidrawDirty("/ws/0.md", true);
    // /ws/4.md is active (just-opened).
    useStore.getState().openFile("/ws/new.md", { recordHistory: false });
    // /ws/0.md (oldest non-active) is evicted even though it had
    // dirty=true. With auto-save, its content is already on disk.
    expect(useStore.getState().tabs.find((t) => t.path === "/ws/0.md")).toBeUndefined();
    expect(useStore.getState().tabs.length).toBe(5);
  });
});
