import { describe, it, expect, beforeEach } from "vitest";
import { useStore } from "@/store/index";

const initialState = useStore.getState();

beforeEach(() => {
  useStore.setState(initialState, true);
});

describe("tabs slice – openFile", () => {
  it("opens a new tab and sets it as active", () => {
    useStore.getState().openFile("/docs/file.md");
    const { tabs, activeTabPath } = useStore.getState();
    expect(tabs).toHaveLength(1);
    expect(tabs[0].path).toBe("/docs/file.md");
    expect(tabs[0].scrollTop).toBe(0);
    expect(typeof tabs[0].lastAccessedAt).toBe("number");
    expect(activeTabPath).toBe("/docs/file.md");
  });

  it("initializes scrollTop to 0 for new tabs", () => {
    useStore.getState().openFile("/docs/file.md");
    expect(useStore.getState().tabs[0].scrollTop).toBe(0);
  });

  it("deduplicates: opening an already-open file does not create a second tab", () => {
    useStore.getState().openFile("/docs/file.md");
    useStore.getState().openFile("/docs/file.md");
    expect(useStore.getState().tabs).toHaveLength(1);
  });

  it("deduplication still activates the existing tab", () => {
    useStore.getState().openFile("/docs/file.md");
    useStore.getState().openFile("/docs/other.md");
    expect(useStore.getState().activeTabPath).toBe("/docs/other.md");

    // Re-open the first file — it should become active without adding a tab
    useStore.getState().openFile("/docs/file.md");
    expect(useStore.getState().activeTabPath).toBe("/docs/file.md");
    expect(useStore.getState().tabs).toHaveLength(2);
  });

  it("appends new tabs in order", () => {
    useStore.getState().openFile("/a.md");
    useStore.getState().openFile("/b.md");
    useStore.getState().openFile("/c.md");
    const paths = useStore.getState().tabs.map((t) => t.path);
    expect(paths).toEqual(["/a.md", "/b.md", "/c.md"]);
  });
});

describe("tabs slice – closeTab", () => {
  it("removes the tab from the list", () => {
    useStore.getState().openFile("/a.md");
    useStore.getState().openFile("/b.md");
    useStore.getState().closeTab("/a.md");
    const paths = useStore.getState().tabs.map((t) => t.path);
    expect(paths).toEqual(["/b.md"]);
  });

  it("does nothing when closing a path that is not open", () => {
    useStore.getState().openFile("/a.md");
    useStore.getState().closeTab("/nonexistent.md");
    expect(useStore.getState().tabs).toHaveLength(1);
  });

  it("activates the tab at the same index after the removed one when closing a non-last tab", () => {
    // Open three tabs: a, b, c — close b → active becomes c (index 1)
    useStore.getState().openFile("/a.md");
    useStore.getState().openFile("/b.md");
    useStore.getState().openFile("/c.md");
    useStore.getState().setActiveTab("/b.md");
    useStore.getState().closeTab("/b.md");
    expect(useStore.getState().activeTabPath).toBe("/c.md");
  });

  it("activates the previous tab when closing the last tab", () => {
    useStore.getState().openFile("/a.md");
    useStore.getState().openFile("/b.md");
    useStore.getState().openFile("/c.md");
    // c is already active; close it → previous tab (b) becomes active
    useStore.getState().closeTab("/c.md");
    expect(useStore.getState().activeTabPath).toBe("/b.md");
  });

  it("sets activeTabPath to null when the only tab is closed", () => {
    useStore.getState().openFile("/a.md");
    useStore.getState().closeTab("/a.md");
    expect(useStore.getState().activeTabPath).toBeNull();
    expect(useStore.getState().tabs).toHaveLength(0);
  });

  it("does not change activeTabPath when closing a tab that is not active", () => {
    useStore.getState().openFile("/a.md");
    useStore.getState().openFile("/b.md");
    // b is active; close a
    useStore.getState().closeTab("/a.md");
    expect(useStore.getState().activeTabPath).toBe("/b.md");
  });

  it("evicts lastFileReloadedAt and lastCommentsReloadedAt for the closed path", () => {
    useStore.getState().openFile("/a.md");
    useStore.getState().openFile("/b.md");
    useStore.getState().setLastFileReloadedAt("/a.md", 111);
    useStore.getState().setLastCommentsReloadedAt("/a.md", 222);
    useStore.getState().setLastFileReloadedAt("/b.md", 333);
    useStore.getState().closeTab("/a.md");
    const s = useStore.getState();
    expect(s.lastFileReloadedAt["/a.md"]).toBeUndefined();
    expect(s.lastCommentsReloadedAt["/a.md"]).toBeUndefined();
    // unrelated paths preserved
    expect(s.lastFileReloadedAt["/b.md"]).toBe(333);
  });
});

describe("tabs slice – setScrollTop", () => {
  it("updates the scrollTop of the matching tab", () => {
    useStore.getState().openFile("/a.md");
    useStore.getState().setScrollTop("/a.md", 350);
    expect(useStore.getState().tabs[0].scrollTop).toBe(350);
  });

  it("only updates the targeted tab, leaving others unchanged", () => {
    useStore.getState().openFile("/a.md");
    useStore.getState().openFile("/b.md");
    useStore.getState().setScrollTop("/a.md", 100);
    const [tabA, tabB] = useStore.getState().tabs;
    expect(tabA.scrollTop).toBe(100);
    expect(tabB.scrollTop).toBe(0);
  });

  it("does nothing when the path does not match any open tab", () => {
    useStore.getState().openFile("/a.md");
    useStore.getState().setScrollTop("/nonexistent.md", 999);
    expect(useStore.getState().tabs[0].scrollTop).toBe(0);
  });
});

describe("tabs slice – setActiveTab", () => {
  it("changes the active tab path", () => {
    useStore.getState().openFile("/a.md");
    useStore.getState().openFile("/b.md");
    useStore.getState().setActiveTab("/a.md");
    expect(useStore.getState().activeTabPath).toBe("/a.md");
  });
});

describe("tabs slice – closeAllTabs", () => {
  it("removes all tabs and clears activeTabPath", () => {
    useStore.getState().openFile("/a.md");
    useStore.getState().openFile("/b.md");
    useStore.getState().closeAllTabs();
    expect(useStore.getState().tabs).toHaveLength(0);
    expect(useStore.getState().activeTabPath).toBeNull();
  });

  it("clears viewModeByTab entries for all closed tabs", () => {
    useStore.getState().openFile("/a.md");
    useStore.getState().setViewMode("/a.md", "source");
    useStore.getState().closeAllTabs();
    expect(useStore.getState().viewModeByTab).toEqual({});
  });

  it("clears lastFileReloadedAt and lastCommentsReloadedAt", () => {
    useStore.getState().openFile("/a.md");
    useStore.getState().setLastFileReloadedAt("/a.md", 111);
    useStore.getState().setLastCommentsReloadedAt("/a.md", 222);
    useStore.getState().closeAllTabs();
    expect(useStore.getState().lastFileReloadedAt).toEqual({});
    expect(useStore.getState().lastCommentsReloadedAt).toEqual({});
  });

  it("is a no-op when there are no tabs", () => {
    useStore.getState().closeAllTabs();
    expect(useStore.getState().tabs).toHaveLength(0);
    expect(useStore.getState().activeTabPath).toBeNull();
  });
});

describe("view mode per tab", () => {
  it("stores and retrieves view mode for a tab", () => {
    useStore.getState().setViewMode("/test.json", "visual");
    expect(useStore.getState().viewModeByTab["/test.json"]).toBe("visual");
  });

  it("defaults to undefined when not set", () => {
    expect(useStore.getState().viewModeByTab["/unknown"]).toBeUndefined();
  });

  it("clears view mode when tab is closed", () => {
    useStore.getState().openFile("/test.json");
    useStore.getState().setViewMode("/test.json", "source");
    useStore.getState().closeTab("/test.json");
    expect(useStore.getState().viewModeByTab["/test.json"]).toBeUndefined();
  });
});
