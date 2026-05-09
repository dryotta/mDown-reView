/**
 * Tabs slice — cross-slice action tests for issue #276.
 *
 * Locks down rule 16 (cross-slice action grouping in `docs/architecture.md`):
 * any tab-context-changing action must dismiss the mermaid popout overlay so
 * the user is never left looking at popout content from a no-longer-active
 * file. Tab-internal actions (scroll, view-mode toggle, file-meta cache
 * patches) are explicitly NOT context changes and must NOT close the popout.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { useStore } from "@/store";
import { invoke } from "@tauri-apps/api/core";

beforeEach(() => {
  useStore.setState({
    tabs: [],
    activeTabPath: null,
    viewModeByTab: {},
    fileMetaByPath: {},
    mermaidPopoutOpenFor: null,
  });
});

describe("tabs slice closes mermaid popout (issue #276)", () => {
  it("openFile closes the popout", async () => {
    useStore.getState().openMermaidPopout("graph");
    await useStore.getState().openFile("/foo.md", { recordHistory: false });
    expect(useStore.getState().mermaidPopoutOpenFor).toBeNull();
  });

  it("closeTab closes the popout", async () => {
    await useStore.getState().openFile("/foo.md", { recordHistory: false });
    useStore.getState().openMermaidPopout("graph");
    useStore.getState().closeTab("/foo.md");
    expect(useStore.getState().mermaidPopoutOpenFor).toBeNull();
  });

  it("closeAllTabs closes the popout", async () => {
    useStore.getState().openMermaidPopout("graph");
    useStore.getState().closeAllTabs();
    expect(useStore.getState().mermaidPopoutOpenFor).toBeNull();
  });

  it("setActiveTab closes the popout", async () => {
    await useStore.getState().openFile("/foo.md", { recordHistory: false });
    await useStore.getState().openFile("/bar.md", { recordHistory: false });
    useStore.getState().openMermaidPopout("graph");
    useStore.getState().setActiveTab("/foo.md", { recordHistory: false });
    expect(useStore.getState().mermaidPopoutOpenFor).toBeNull();
  });

  it("setScrollTop does NOT close the popout", async () => {
    await useStore.getState().openFile("/foo.md", { recordHistory: false });
    useStore.getState().openMermaidPopout("graph");
    useStore.getState().setScrollTop("/foo.md", 100);
    expect(useStore.getState().mermaidPopoutOpenFor).not.toBeNull();
  });

  it("setViewMode does NOT close the popout (source/visual toggle stays in same file)", async () => {
    await useStore.getState().openFile("/foo.md", { recordHistory: false });
    useStore.getState().openMermaidPopout("graph");
    useStore.getState().setViewMode("/foo.md", "source");
    expect(useStore.getState().mermaidPopoutOpenFor).not.toBeNull();
  });

  it("setFileMeta does NOT close the popout (metadata cache, not navigation)", async () => {
    await useStore.getState().openFile("/foo.md", { recordHistory: false });
    useStore.getState().openMermaidPopout("graph");
    useStore.getState().setFileMeta("/foo.md", { sizeBytes: 123 });
    expect(useStore.getState().mermaidPopoutOpenFor).not.toBeNull();
  });
});

describe("setFileMeta slice diff (issue #280, iter 3, group G3)", () => {
  it("returns the same fileMetaByPath reference when patch is field-by-field identical", async () => {
    useStore.getState().setFileMeta("/foo.md", {
      sizeBytes: 100,
      lineCount: 5,
      fileMtime: 1000,
      commentsMtime: null,
    });
    const before = useStore.getState().fileMetaByPath;

    // Re-apply the identical patch.
    useStore.getState().setFileMeta("/foo.md", {
      sizeBytes: 100,
      lineCount: 5,
      fileMtime: 1000,
      commentsMtime: null,
    });
    const after = useStore.getState().fileMetaByPath;

    expect(Object.is(before, after)).toBe(true);
  });

  it("creates a new fileMetaByPath reference when fileMtime changes", async () => {
    useStore.getState().setFileMeta("/foo.md", {
      sizeBytes: 100,
      lineCount: 5,
      fileMtime: 1000,
    });
    const before = useStore.getState().fileMetaByPath;

    useStore.getState().setFileMeta("/foo.md", { fileMtime: 2000 });
    const after = useStore.getState().fileMetaByPath;

    expect(Object.is(before, after)).toBe(false);
    expect(after["/foo.md"]?.fileMtime).toBe(2000);
    // Other fields must survive the merge.
    expect(after["/foo.md"]?.sizeBytes).toBe(100);
    expect(after["/foo.md"]?.lineCount).toBe(5);
  });

  it("creates a new fileMetaByPath reference for a path with no existing entry", async () => {
    const before = useStore.getState().fileMetaByPath;
    expect(before["/new.md"]).toBeUndefined();

    useStore.getState().setFileMeta("/new.md", { sizeBytes: 42 });
    const after = useStore.getState().fileMetaByPath;

    expect(Object.is(before, after)).toBe(false);
    expect(after["/new.md"]?.sizeBytes).toBe(42);
  });
});

// ────────────────────────────────────────────────────────────────────────
// Issue #359 — openFile async + register_window_file ordering contract.
//
// The renderer-side fix for "files outside the workspace fail to load":
// `openFile` now `await commands.registerWindowFile(path)` BEFORE
// inserting the tab (so the runtime allowlist contains the file by
// the time `useFileContent` reads it). These tests pin the contract.
// ────────────────────────────────────────────────────────────────────────

describe("openFile async ordering (issue #359)", () => {
  const invokeMock = vi.mocked(invoke);

  beforeEach(() => {
    useStore.setState({
      tabs: [],
      activeTabPath: null,
      viewModeByTab: {},
      fileMetaByPath: {},
      excalidrawDirtyByTab: {},
      externalChangePendingByTab: {},
      excalidrawEditorMounts: [],
      pendingOpenAt: null,
      recentItems: [],
    });
  });

  afterEach(() => {
    invokeMock.mockClear();
  });

  it("atomicallySetsReadOnlyAndPath_singleEmission: no transient frame where path exists but readOnly is undefined", async () => {
    // Default mock returns `{ tier: "outside", canonical: <p> }` for this path
    // by overriding register_window_file just for this case.
    invokeMock.mockImplementationOnce(async (cmd, args) => {
      if (cmd === "register_window_file") {
        const a = args as { path?: string } | undefined;
        const p = a?.path ?? "";
        return {
          canonical: p,
          classification: { tier: "outside", canonical: p },
        };
      }
      return undefined;
    });
    const observed: Array<{ hasPath: boolean; readOnly: boolean | undefined }> = [];
    const unsub = useStore.subscribe((s) => {
      const tab = s.tabs.find((t) => t.path === "/outside/file.md");
      if (tab) observed.push({ hasPath: true, readOnly: tab.readOnly });
    });
    try {
      await useStore.getState().openFile("/outside/file.md", { recordHistory: false });
    } finally {
      unsub();
    }
    // First emission with the path MUST already have a defined readOnly.
    expect(observed.length).toBeGreaterThan(0);
    expect(observed[0]).toEqual({ hasPath: true, readOnly: true });
    // Subsequent emissions (if any) must keep readOnly defined.
    for (const e of observed) expect(typeof e.readOnly).toBe("boolean");
  });

  it("dispatchesRegisterBeforeReturning: register_window_file is invoked before the tab insertion set()", async () => {
    let registerCalled = false;
    let tabInsertedBeforeRegister: boolean | null = null;
    invokeMock.mockImplementationOnce(async (cmd, args) => {
      if (cmd === "register_window_file") {
        const a = args as { path?: string } | undefined;
        // At the moment register fires, the tab MUST NOT yet exist.
        tabInsertedBeforeRegister = useStore
          .getState()
          .tabs.some((t) => t.path === (a?.path ?? ""));
        registerCalled = true;
        const p = a?.path ?? "";
        return {
          canonical: p,
          classification: { tier: "inside", canonical: p },
        };
      }
      return undefined;
    });
    await useStore.getState().openFile("/ws/order.md", { recordHistory: false });
    expect(registerCalled).toBe(true);
    expect(tabInsertedBeforeRegister).toBe(false);
    // After the await, the tab IS present.
    expect(
      useStore.getState().tabs.some((t) => t.path === "/ws/order.md"),
    ).toBe(true);
  });

  it("onRegisterReject_doesNotInsertTab: rejection from register_window_file leaves tabs untouched and rethrows", async () => {
    invokeMock.mockImplementationOnce(async (cmd) => {
      if (cmd === "register_window_file") {
        throw "system path blocked";
      }
      return undefined;
    });
    const before = useStore.getState().tabs.length;
    await expect(
      useStore.getState().openFile("/sys/restricted.md", { recordHistory: false }),
    ).rejects.toBeDefined();
    // Tab NOT inserted.
    expect(useStore.getState().tabs.length).toBe(before);
    // Active path untouched (still null from beforeEach reset).
    expect(useStore.getState().activeTabPath).toBeNull();
    // Stale-request guard cleaned up.
    expect(useStore.getState().pendingOpenAt).toBeNull();
  });

  it("rapidSwitch_dropsStaleInsert: A's late insert does NOT clobber B as active tab", async () => {
    // Pin two register calls: A is slow, B is fast. Resolve B first then A.
    let resolveA: (v: unknown) => void = () => {};
    invokeMock.mockImplementationOnce(
      (cmd, args) =>
        new Promise((res) => {
          if (cmd !== "register_window_file") {
            res(undefined);
            return;
          }
          const a = args as { path?: string } | undefined;
          const p = a?.path ?? "";
          resolveA = () =>
            res({ canonical: p, classification: { tier: "inside", canonical: p } });
        }),
    );
    invokeMock.mockImplementationOnce(async (cmd, args) => {
      if (cmd !== "register_window_file") return undefined;
      const a = args as { path?: string } | undefined;
      const p = a?.path ?? "";
      return { canonical: p, classification: { tier: "inside", canonical: p } };
    });

    const aPromise = useStore
      .getState()
      .openFile("/ws/A.md", { recordHistory: false });
    const bPromise = useStore
      .getState()
      .openFile("/ws/B.md", { recordHistory: false });

    // Drive B first (fast resolver).
    await bPromise;
    // B's tab must be present and active.
    expect(useStore.getState().activeTabPath).toBe("/ws/B.md");
    expect(useStore.getState().tabs.map((t) => t.path)).toEqual(["/ws/B.md"]);

    // Now drive A. The post-await guard must drop A's insert because
    // pendingOpenAt has advanced past A's captured sentinel.
    resolveA(undefined);
    await aPromise;

    // A did NOT clobber B.
    expect(useStore.getState().activeTabPath).toBe("/ws/B.md");
    // A is NOT inserted (the guard dropped its set()).
    expect(useStore.getState().tabs.map((t) => t.path)).toEqual(["/ws/B.md"]);
  });
});
