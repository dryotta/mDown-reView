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
    // Single dirty tab → singular wording.
    expect(confirmSpy).toHaveBeenCalledWith("Discard changes?");
    expect(useStore.getState().tabs).toEqual([]);
    expect(useStore.getState().excalidrawDirtyByTab).toEqual({});
    expect(useStore.getState().externalChangePendingByTab).toEqual({});
  });

  it("closeAllTabs prompt names the count when multiple tabs are dirty", () => {
    useStore.getState().openFile("/ws/a.excalidraw", { recordHistory: false });
    useStore.getState().openFile("/ws/b.excalidraw", { recordHistory: false });
    useStore.getState().openFile("/ws/c.excalidraw", { recordHistory: false });
    useStore.getState().setExcalidrawDirty("/ws/a.excalidraw", true);
    useStore.getState().setExcalidrawDirty("/ws/b.excalidraw", true);
    useStore.getState().setExcalidrawDirty("/ws/c.excalidraw", true);
    useStore.getState().closeAllTabs();
    expect(confirmSpy).toHaveBeenCalledWith("Discard changes to 3 files?");
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

// Issue #352 / iter-5 BLOCKER (product B1 + bug P0 + rubber-duck #1) —
// `setActiveTab` MUST prompt before switching away from a dirty
// Excalidraw editor tab, otherwise the unmount of `<ExcalidrawView/>`
// silently discards the live scene with no warning. Same prompt as
// closeTab; same fail-closed semantics.
describe("setActiveTab guard for dirty Excalidraw editor (iter-5 BLOCKER)", () => {
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

  it("does NOT prompt when leaving an Excalidraw tab that is NOT in editor mode", () => {
    useStore.getState().openFile("/ws/a.excalidraw", { recordHistory: false });
    useStore.getState().openFile("/ws/b.md", { recordHistory: false });
    // Stored mode is visual; dirty flag set to true is a synthetic
    // edge case, but we want to verify the guard requires editor mode.
    useStore.getState().setExcalidrawDirty("/ws/a.excalidraw", true);
    useStore.setState({
      viewModeByTab: { "/ws/a.excalidraw": "visual" },
    });
    useStore.setState({ activeTabPath: "/ws/a.excalidraw" });
    useStore.getState().setActiveTab("/ws/b.md", { recordHistory: false });
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it("PROMPTS Discard changes? when leaving a dirty Excalidraw editor tab", () => {
    useStore.getState().openFile("/ws/a.excalidraw", { recordHistory: false });
    useStore.getState().openFile("/ws/b.md", { recordHistory: false });
    useStore.setState({
      activeTabPath: "/ws/a.excalidraw",
      viewModeByTab: { "/ws/a.excalidraw": "editor" },
    });
    useStore.getState().setExcalidrawDirty("/ws/a.excalidraw", true);
    useStore.getState().setActiveTab("/ws/b.md", { recordHistory: false });
    expect(confirmSpy).toHaveBeenCalledWith("Discard changes?");
  });

  it("ABORTS the switch when user cancels the prompt", () => {
    confirmSpy.mockReturnValue(false);
    useStore.getState().openFile("/ws/a.excalidraw", { recordHistory: false });
    useStore.getState().openFile("/ws/b.md", { recordHistory: false });
    useStore.setState({
      activeTabPath: "/ws/a.excalidraw",
      viewModeByTab: { "/ws/a.excalidraw": "editor" },
    });
    useStore.getState().setExcalidrawDirty("/ws/a.excalidraw", true);
    useStore.getState().setActiveTab("/ws/b.md", { recordHistory: false });
    // Active still on the dirty tab; dirty flag preserved.
    expect(useStore.getState().activeTabPath).toBe("/ws/a.excalidraw");
    expect(useStore.getState().excalidrawDirtyByTab["/ws/a.excalidraw"]).toBe(true);
  });

  it("PROCEEDS and clears dirty/pending when user confirms", () => {
    useStore.getState().openFile("/ws/a.excalidraw", { recordHistory: false });
    useStore.getState().openFile("/ws/b.md", { recordHistory: false });
    useStore.setState({
      activeTabPath: "/ws/a.excalidraw",
      viewModeByTab: { "/ws/a.excalidraw": "editor" },
    });
    useStore.getState().setExcalidrawDirty("/ws/a.excalidraw", true);
    useStore.getState().setExternalChangePending("/ws/a.excalidraw", true);
    useStore.getState().setActiveTab("/ws/b.md", { recordHistory: false });
    expect(useStore.getState().activeTabPath).toBe("/ws/b.md");
    expect(useStore.getState().excalidrawDirtyByTab["/ws/a.excalidraw"]).toBeUndefined();
    expect(
      useStore.getState().externalChangePendingByTab["/ws/a.excalidraw"],
    ).toBeUndefined();
  });

  it("setViewMode out of editor PROMPTS when dirty + ABORTS on cancel", () => {
    confirmSpy.mockReturnValue(false);
    useStore.getState().openFile("/ws/a.excalidraw", { recordHistory: false });
    useStore.getState().setViewMode("/ws/a.excalidraw", "editor");
    useStore.getState().setExcalidrawDirty("/ws/a.excalidraw", true);
    useStore.getState().setViewMode("/ws/a.excalidraw", "visual");
    expect(confirmSpy).toHaveBeenCalledWith("Discard changes?");
    // Still in editor mode + still dirty.
    expect(useStore.getState().viewModeByTab["/ws/a.excalidraw"]).toBe("editor");
    expect(useStore.getState().excalidrawDirtyByTab["/ws/a.excalidraw"]).toBe(true);
  });
});

describe("LRU eviction respects dirty Excalidraw editor tabs (issue #352)", () => {
  let confirmSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    confirmSpy = vi.spyOn(globalThis, "confirm").mockReturnValue(true);
  });

  afterEach(() => {
    confirmSpy.mockRestore();
  });

  it("evicting a clean tab silently cleans its (empty) maps — no prompt", () => {
    // Open MAX_TABS+1 to force eviction. MAX_TABS is 5.
    for (let i = 0; i < 5; i++) {
      useStore.getState().openFile(`/ws/${i}.md`, { recordHistory: false });
    }
    // Open a new tab — this triggers LRU eviction of /ws/0.md (oldest).
    useStore.getState().openFile("/ws/new.md", { recordHistory: false });
    // No prompt fired since no dirty tabs.
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(
      useStore.getState().tabs.find((t) => t.path === "/ws/0.md"),
    ).toBeUndefined();
  });

  it("BYPASSES MAX_TABS when ALL LRU candidates are dirty Excalidraw editors (no prompt, all preserved)", () => {
    // Open MAX_TABS tabs and mark every non-active one as dirty.
    for (let i = 0; i < 5; i++) {
      useStore.getState().openFile(`/ws/${i}.md`, { recordHistory: false });
    }
    // Active is /ws/4.md (most recent open). Mark all the others dirty.
    useStore.getState().setExcalidrawDirty("/ws/0.md", true);
    useStore.getState().setExcalidrawDirty("/ws/1.md", true);
    useStore.getState().setExcalidrawDirty("/ws/2.md", true);
    useStore.getState().setExcalidrawDirty("/ws/3.md", true);

    // Open a 6th tab — every non-active candidate is dirty, so the
    // cap stretches.
    useStore.getState().openFile("/ws/new.md", { recordHistory: false });

    // No prompt — the user wasn't asked to discard.
    expect(confirmSpy).not.toHaveBeenCalled();
    // All four dirty tabs survive.
    for (let i = 0; i < 4; i++) {
      expect(
        useStore.getState().tabs.find((t) => t.path === `/ws/${i}.md`),
      ).toBeDefined();
      expect(useStore.getState().excalidrawDirtyByTab[`/ws/${i}.md`]).toBe(true);
    }
    // Cap is exceeded.
    expect(useStore.getState().tabs.length).toBe(6);
    // New tab opened.
    expect(useStore.getState().tabs.find((t) => t.path === "/ws/new.md")).toBeDefined();
  });

  it("evicts the OLDEST CLEAN tab when a dirty editor exists alongside it", () => {
    for (let i = 0; i < 5; i++) {
      useStore.getState().openFile(`/ws/${i}.md`, { recordHistory: false });
    }
    // /ws/0.md is the oldest, mark it dirty.
    useStore.getState().setExcalidrawDirty("/ws/0.md", true);
    // /ws/4.md is the active (just-opened); the next-LRU clean is /ws/1.md.

    useStore.getState().openFile("/ws/new.md", { recordHistory: false });

    // No prompt — only clean tabs are eligible victims.
    expect(confirmSpy).not.toHaveBeenCalled();
    // Dirty tab survives.
    expect(useStore.getState().tabs.find((t) => t.path === "/ws/0.md")).toBeDefined();
    // Oldest CLEAN tab evicted.
    expect(useStore.getState().tabs.find((t) => t.path === "/ws/1.md")).toBeUndefined();
    // Cap respected (5).
    expect(useStore.getState().tabs.length).toBe(5);
  });
});
