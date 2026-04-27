import { describe, it, expect, beforeEach } from "vitest";
import { useStore, filterStaleTabs, MAX_TABS, type Tab } from "@/store/index";

const initialState = useStore.getState();

beforeEach(() => {
  useStore.setState(initialState, true);
});

describe("tabs slice — LRU eviction (MAX_TABS)", () => {
  it("MAX_TABS is exported and equals 15", () => {
    expect(MAX_TABS).toBe(15);
  });

  it("evicts oldest non-active tab when opening past MAX_TABS", () => {
    const store = useStore.getState();
    for (let i = 1; i <= MAX_TABS + 1; i++) {
      store.openFile(`/p${i}.md`);
    }
    const { tabs, activeTabPath } = useStore.getState();
    expect(tabs).toHaveLength(MAX_TABS);
    expect(activeTabPath).toBe(`/p${MAX_TABS + 1}.md`);
    // p1 was the oldest non-active and must have been evicted
    expect(tabs.find((t) => t.path === "/p1.md")).toBeUndefined();
    // The newly opened path is present
    expect(tabs.find((t) => t.path === `/p${MAX_TABS + 1}.md`)).toBeDefined();
  });

  it("does NOT evict a recently re-activated tab", () => {
    const store = useStore.getState();
    // Open 15 tabs
    for (let i = 1; i <= MAX_TABS; i++) {
      store.openFile(`/p${i}.md`);
    }
    // Re-activate p1 (bumps its lastAccessedAt to newest)
    useStore.getState().setActiveTab("/p1.md");
    // Open one more — should evict p2 (now the oldest non-active), NOT p1
    useStore.getState().openFile(`/p${MAX_TABS + 1}.md`);
    const { tabs } = useStore.getState();
    expect(tabs).toHaveLength(MAX_TABS);
    expect(tabs.find((t) => t.path === "/p1.md")).toBeDefined();
    expect(tabs.find((t) => t.path === "/p2.md")).toBeUndefined();
  });

  it("never evicts the active tab", () => {
    const store = useStore.getState();
    store.openFile("/p1.md");
    // p1 is now active. Open 15 more — p1 must remain because it's active.
    for (let i = 2; i <= MAX_TABS + 1; i++) {
      // Reactivate p1 explicitly before each open so it's the activeTabPath when eviction runs
      useStore.getState().setActiveTab("/p1.md");
      useStore.getState().openFile(`/p${i}.md`);
    }
    const { tabs } = useStore.getState();
    expect(tabs).toHaveLength(MAX_TABS);
    expect(tabs.find((t) => t.path === "/p1.md")).toBeDefined();
  });

  it("opening the same path twice does not duplicate and bumps lastAccessedAt", async () => {
    const store = useStore.getState();
    store.openFile("/p1.md");
    store.openFile("/p2.md");
    const firstTs = useStore.getState().tabs.find((t) => t.path === "/p1.md")!.lastAccessedAt!;
    // Sleep one tick to guarantee a strictly greater Date.now()
    await new Promise((r) => setTimeout(r, 2));
    useStore.getState().openFile("/p1.md");
    const tabs = useStore.getState().tabs;
    expect(tabs).toHaveLength(2);
    const newTs = tabs.find((t) => t.path === "/p1.md")!.lastAccessedAt!;
    expect(newTs).toBeGreaterThan(firstTs);
    expect(useStore.getState().activeTabPath).toBe("/p1.md");
  });

  it("setActiveTab bumps lastAccessedAt on the targeted tab", async () => {
    const store = useStore.getState();
    store.openFile("/p1.md");
    store.openFile("/p2.md");
    const before = useStore.getState().tabs.find((t) => t.path === "/p1.md")!.lastAccessedAt;
    await new Promise((r) => setTimeout(r, 2));
    useStore.getState().setActiveTab("/p1.md");
    const after = useStore.getState().tabs.find((t) => t.path === "/p1.md")!.lastAccessedAt;
    expect(after!).toBeGreaterThan(before!);
  });

  it("evicts viewModeByTab and lastSaveByPath entries for the evicted tab", () => {
    const store = useStore.getState();
    store.openFile("/p1.md");
    useStore.getState().setViewMode("/p1.md", "source");
    useStore.getState().recordSave("/p1.md");
    // Activate p2 so p1 is the LRU candidate
    for (let i = 2; i <= MAX_TABS; i++) {
      useStore.getState().openFile(`/p${i}.md`);
    }
    useStore.getState().openFile(`/p${MAX_TABS + 1}.md`);
    const s = useStore.getState();
    expect(s.tabs.find((t) => t.path === "/p1.md")).toBeUndefined();
    expect(s.viewModeByTab["/p1.md"]).toBeUndefined();
    expect(s.lastSaveByPath["/p1.md"]).toBeUndefined();
  });

  it("MAX_TABS overflow evicts fileMetaByPath entry for the evicted tab", () => {
    const store = useStore.getState();
    // Open p1 first and seed its FileMeta — it will be the LRU eviction candidate.
    store.openFile("/p1.md");
    useStore.getState().setFileMeta("/p1.md", { fileMtime: 9999 });
    for (let i = 2; i <= MAX_TABS; i++) {
      useStore.getState().openFile(`/p${i}.md`);
    }
    // One more open triggers eviction of the LRU non-active tab (p1).
    useStore.getState().openFile(`/p${MAX_TABS + 1}.md`);
    const s = useStore.getState();
    expect(s.tabs.find((t) => t.path === "/p1.md")).toBeUndefined();
    expect(s.fileMetaByPath["/p1.md"]).toBeUndefined();
  });

});

describe("filterStaleTabs — MAX_TABS rehydration cap", () => {
  function makeTab(path: string, lastAccessedAt: number): Tab {
    return { path, scrollTop: 0, lastAccessedAt };
  }

  it("trims a 20-tab snapshot down to MAX_TABS, dropping oldest by lastAccessedAt", () => {
    const tabs: Tab[] = [];
    for (let i = 0; i < 20; i++) {
      // Earlier indices = older timestamps
      tabs.push(makeTab(`/p${i}.md`, 1000 + i));
    }
    const result = filterStaleTabs(tabs, "/p10.md", new Map());
    expect(result.tabs).toHaveLength(MAX_TABS);
    expect(result.activeTabPath).toBe("/p10.md");
    // active retained
    expect(result.tabs.find((t) => t.path === "/p10.md")).toBeDefined();
    // The oldest non-active ones should be gone (p0..p4 expected to be dropped)
    expect(result.tabs.find((t) => t.path === "/p0.md")).toBeUndefined();
    // The newest ones should be retained
    expect(result.tabs.find((t) => t.path === "/p19.md")).toBeDefined();
  });

  it("retains active tab even when it has the oldest lastAccessedAt", () => {
    const tabs: Tab[] = [];
    tabs.push(makeTab("/active.md", 0)); // oldest by far
    for (let i = 1; i <= 20; i++) {
      tabs.push(makeTab(`/p${i}.md`, 1000 + i));
    }
    const result = filterStaleTabs(tabs, "/active.md", new Map());
    expect(result.tabs).toHaveLength(MAX_TABS);
    expect(result.tabs.find((t) => t.path === "/active.md")).toBeDefined();
    expect(result.activeTabPath).toBe("/active.md");
  });

  it("treats missing lastAccessedAt (legacy snapshot) as 0 and evicts those first", () => {
    const tabs: Tab[] = [];
    // Five legacy tabs with no timestamp
    for (let i = 0; i < 5; i++) {
      tabs.push({ path: `/legacy${i}.md`, scrollTop: 0 } as unknown as Tab);
    }
    // 15 modern tabs
    for (let i = 0; i < 15; i++) {
      tabs.push(makeTab(`/new${i}.md`, 5000 + i));
    }
    const result = filterStaleTabs(tabs, null, new Map());
    expect(result.tabs).toHaveLength(MAX_TABS);
    // All legacy tabs evicted
    for (let i = 0; i < 5; i++) {
      expect(result.tabs.find((t) => t.path === `/legacy${i}.md`)).toBeUndefined();
    }
  });

  it("does nothing when tab count <= MAX_TABS and all files exist", () => {
    const tabs: Tab[] = [];
    for (let i = 0; i < 5; i++) tabs.push(makeTab(`/p${i}.md`, 1000 + i));
    const result = filterStaleTabs(tabs, "/p2.md", new Map());
    expect(result.tabs).toHaveLength(5);
    expect(result.activeTabPath).toBe("/p2.md");
  });
});
