/**
 * Issue #352 / iter-13 — persistent Excalidraw mount registry.
 *
 * The store-side contract: paths are added to `excalidrawEditorMounts`
 * via `markExcalidrawEditorMounted` (idempotent) and removed by
 * `closeTab`, `closeAllTabs`, and LRU eviction. The host component
 * (`PersistentExcalidrawHost`) reads this slice to decide which
 * `<Excalidraw>` instances to keep alive across tab switches.
 *
 * These tests lock the cleanup contract — a regression here means a
 * memory leak (orphaned `<Excalidraw>` instances) or a missing
 * Excalidraw mount on tab reopen.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { useStore } from "@/store";
import { MAX_TABS } from "@/store/tabs";

beforeEach(() => {
  useStore.setState({
    tabs: [],
    activeTabPath: null,
    viewModeByTab: {},
    fileMetaByPath: {},
    excalidrawDirtyByTab: {},
    externalChangePendingByTab: {},
    excalidrawEditorMounts: [],
    lastSaveByPath: {},
  });
});

describe("excalidrawEditorMounts (issue #352 / iter-13)", () => {
  it("starts empty", () => {
    expect(useStore.getState().excalidrawEditorMounts).toEqual([]);
  });

  it("markExcalidrawEditorMounted adds the path", () => {
    useStore.getState().markExcalidrawEditorMounted("/ws/a.excalidraw");
    expect(useStore.getState().excalidrawEditorMounts).toEqual([
      "/ws/a.excalidraw",
    ]);
  });

  it("markExcalidrawEditorMounted is idempotent (returns SAME state on duplicate)", () => {
    useStore.getState().markExcalidrawEditorMounted("/ws/a.excalidraw");
    const before = useStore.getState().excalidrawEditorMounts;
    useStore.getState().markExcalidrawEditorMounted("/ws/a.excalidraw");
    const after = useStore.getState().excalidrawEditorMounts;
    expect(after).toBe(before); // referential equality — no re-render
  });

  it("supports multiple registered paths in registration order", () => {
    useStore.getState().markExcalidrawEditorMounted("/ws/a.excalidraw");
    useStore.getState().markExcalidrawEditorMounted("/ws/b.excalidraw");
    useStore.getState().markExcalidrawEditorMounted("/ws/c.excalidrawlib");
    expect(useStore.getState().excalidrawEditorMounts).toEqual([
      "/ws/a.excalidraw",
      "/ws/b.excalidraw",
      "/ws/c.excalidrawlib",
    ]);
  });

  it("closeTab unregisters the closing path", () => {
    useStore.getState().openFile("/ws/a.excalidraw");
    useStore.getState().openFile("/ws/b.excalidraw");
    useStore.getState().markExcalidrawEditorMounted("/ws/a.excalidraw");
    useStore.getState().markExcalidrawEditorMounted("/ws/b.excalidraw");
    useStore.getState().closeTab("/ws/a.excalidraw");
    expect(useStore.getState().excalidrawEditorMounts).toEqual([
      "/ws/b.excalidraw",
    ]);
  });

  it("closeTab leaves OTHER registered paths intact", () => {
    useStore.getState().openFile("/ws/a.excalidraw");
    useStore.getState().openFile("/ws/b.excalidraw");
    useStore.getState().openFile("/ws/c.excalidraw");
    useStore.getState().markExcalidrawEditorMounted("/ws/a.excalidraw");
    useStore.getState().markExcalidrawEditorMounted("/ws/b.excalidraw");
    useStore.getState().markExcalidrawEditorMounted("/ws/c.excalidraw");
    useStore.getState().closeTab("/ws/b.excalidraw");
    expect(useStore.getState().excalidrawEditorMounts).toEqual([
      "/ws/a.excalidraw",
      "/ws/c.excalidraw",
    ]);
  });

  it("closeAllTabs clears the registry", () => {
    useStore.getState().openFile("/ws/a.excalidraw");
    useStore.getState().openFile("/ws/b.excalidraw");
    useStore.getState().markExcalidrawEditorMounted("/ws/a.excalidraw");
    useStore.getState().markExcalidrawEditorMounted("/ws/b.excalidraw");
    useStore.getState().closeAllTabs();
    expect(useStore.getState().excalidrawEditorMounts).toEqual([]);
  });

  it("LRU eviction unregisters the evicted path", () => {
    // Open MAX_TABS files, register all as Excalidraw editors.
    for (let i = 0; i < MAX_TABS; i++) {
      useStore.getState().openFile(`/ws/${i}.excalidraw`);
      useStore.getState().markExcalidrawEditorMounted(`/ws/${i}.excalidraw`);
    }
    expect(useStore.getState().excalidrawEditorMounts.length).toBe(MAX_TABS);
    // Open a new tab — triggers LRU eviction of the oldest non-active.
    useStore.getState().openFile("/ws/new.md");
    // The evicted path's mount should be gone.
    expect(useStore.getState().excalidrawEditorMounts).not.toContain(
      "/ws/0.excalidraw",
    );
    expect(useStore.getState().excalidrawEditorMounts.length).toBe(MAX_TABS - 1);
  });

  it("closeTab cleanup is atomic (single set() — multi-slice consistency)", () => {
    // Rule 16 in `docs/architecture.md` — multi-slice cleanups MUST be
    // a single set() call so subscribers never observe an
    // intermediate state. We assert by subscribing once and counting
    // the snapshot transitions during a single closeTab.
    useStore.getState().openFile("/ws/a.excalidraw");
    useStore.getState().markExcalidrawEditorMounted("/ws/a.excalidraw");
    useStore.getState().setExcalidrawDirty("/ws/a.excalidraw", true);
    useStore.getState().setExternalChangePending("/ws/a.excalidraw", true);

    let transitions = 0;
    const unsub = useStore.subscribe(() => {
      transitions += 1;
    });
    useStore.getState().closeTab("/ws/a.excalidraw");
    unsub();

    // Exactly ONE transition: tabs + activeTabPath + viewModeByTab +
    // lastSaveByPath + fileMetaByPath + excalidrawDirtyByTab +
    // externalChangePendingByTab + excalidrawEditorMounts all flipped
    // in a single store update.
    expect(transitions).toBe(1);
    expect(useStore.getState().excalidrawEditorMounts).toEqual([]);
    expect(useStore.getState().excalidrawDirtyByTab).toEqual({});
    expect(useStore.getState().externalChangePendingByTab).toEqual({});
  });
});
