import { describe, it, expect, beforeEach, vi } from "vitest";
import { useStore, filterStaleTabs, validatePersistedTabs } from "@/store";
import type { Tab } from "@/store";

beforeEach(() => {
  useStore.setState({ tabs: [], activeTabPath: null });
  localStorage.clear();
});

// ── partialize ─────────────────────────────────────────────────────────────

describe("tab persistence — partialize", () => {
  it("includes tabs and activeTabPath in persisted state", () => {
    const tabs: Tab[] = [
      { path: "/a.md", scrollTop: 0 },
      { path: "/b.md", scrollTop: 42 },
    ];
    useStore.setState({ tabs, activeTabPath: "/b.md" });

    const stored = JSON.parse(localStorage.getItem("mdownreview-ui") || "{}");
    expect(stored.state.tabs).toEqual(tabs);
    expect(stored.state.activeTabPath).toBe("/b.md");
  });
});

// ── filterStaleTabs (pure) ─────────────────────────────────────────────────

describe("filterStaleTabs", () => {
  it("removes tabs whose files no longer exist", () => {
    const tabs: Tab[] = [
      { path: "/exists.md", scrollTop: 0 },
      { path: "/gone.md", scrollTop: 10 },
    ];
    const existsMap = new Map([
      ["/exists.md", true],
      ["/gone.md", false],
    ]);

    const result = filterStaleTabs(tabs, "/exists.md", existsMap);
    expect(result.tabs).toEqual([{ path: "/exists.md", scrollTop: 0 }]);
    expect(result.activeTabPath).toBe("/exists.md");
  });

  it("sets activeTabPath to first tab when active tab is removed", () => {
    const tabs: Tab[] = [
      { path: "/a.md", scrollTop: 0 },
      { path: "/b.md", scrollTop: 0 },
    ];
    const existsMap = new Map([
      ["/a.md", true],
      ["/b.md", false],
    ]);

    const result = filterStaleTabs(tabs, "/b.md", existsMap);
    expect(result.tabs).toEqual([{ path: "/a.md", scrollTop: 0 }]);
    expect(result.activeTabPath).toBe("/a.md");
  });

  it("sets activeTabPath to null when all tabs are removed", () => {
    const tabs: Tab[] = [{ path: "/gone.md", scrollTop: 0 }];
    const existsMap = new Map([["/gone.md", false]]);

    const result = filterStaleTabs(tabs, "/gone.md", existsMap);
    expect(result.tabs).toEqual([]);
    expect(result.activeTabPath).toBeNull();
  });

  it("preserves all tabs when all exist", () => {
    const tabs: Tab[] = [
      { path: "/a.md", scrollTop: 5 },
      { path: "/b.md", scrollTop: 10 },
    ];
    const existsMap = new Map([
      ["/a.md", true],
      ["/b.md", true],
    ]);

    const result = filterStaleTabs(tabs, "/a.md", existsMap);
    expect(result.tabs).toEqual(tabs);
    expect(result.activeTabPath).toBe("/a.md");
  });

  it("keeps activeTabPath unchanged when it still exists", () => {
    const tabs: Tab[] = [
      { path: "/a.md", scrollTop: 0 },
      { path: "/b.md", scrollTop: 0 },
      { path: "/c.md", scrollTop: 0 },
    ];
    const existsMap = new Map([
      ["/a.md", false],
      ["/b.md", true],
      ["/c.md", true],
    ]);

    const result = filterStaleTabs(tabs, "/c.md", existsMap);
    expect(result.activeTabPath).toBe("/c.md");
    expect(result.tabs).toHaveLength(2);
  });
});

// ── validatePersistedTabs (async + store integration) ──────────────────────

describe("validatePersistedTabs", () => {
  it("removes tabs for missing files from the store", async () => {
    useStore.setState({
      tabs: [
        { path: "/exists.md", scrollTop: 0 },
        { path: "/gone.md", scrollTop: 0 },
      ],
      activeTabPath: "/exists.md",
    });

    const mockChecker = async (path: string) =>
      path === "/exists.md" ? ("file" as const) : ("missing" as const);

    await validatePersistedTabs(mockChecker);

    const state = useStore.getState();
    expect(state.tabs).toEqual([{ path: "/exists.md", scrollTop: 0 }]);
    expect(state.activeTabPath).toBe("/exists.md");
  });

  it("corrects activeTabPath when it points to a removed file", async () => {
    useStore.setState({
      tabs: [
        { path: "/a.md", scrollTop: 0 },
        { path: "/b.md", scrollTop: 0 },
      ],
      activeTabPath: "/b.md",
    });

    const mockChecker = async (path: string) =>
      path === "/a.md" ? ("file" as const) : ("missing" as const);

    await validatePersistedTabs(mockChecker);

    const state = useStore.getState();
    expect(state.tabs).toEqual([{ path: "/a.md", scrollTop: 0 }]);
    expect(state.activeTabPath).toBe("/a.md");
  });

  it("is a no-op when tabs are empty", async () => {
    useStore.setState({ tabs: [], activeTabPath: null });

    const mockChecker = vi.fn();

    await validatePersistedTabs(mockChecker);

    expect(mockChecker).not.toHaveBeenCalled();
    expect(useStore.getState().tabs).toEqual([]);
  });

  it("propagates checkPath rejection", async () => {
    useStore.setState({
      tabs: [
        { path: "/a.md", scrollTop: 0 },
        { path: "/b.md", scrollTop: 0 },
      ],
      activeTabPath: "/a.md",
    });

    const mockChecker = vi.fn().mockRejectedValue(new Error("disk error"));

    await expect(validatePersistedTabs(mockChecker)).rejects.toThrow("disk error");
  });

  it("keeps directories as valid tabs", async () => {
    useStore.setState({
      tabs: [{ path: "/folder", scrollTop: 0 }],
      activeTabPath: "/folder",
    });

    const mockChecker = async () => "dir" as const;

    await validatePersistedTabs(mockChecker);

    const state = useStore.getState();
    expect(state.tabs).toEqual([{ path: "/folder", scrollTop: 0 }]);
    expect(state.activeTabPath).toBe("/folder");
  });
});
