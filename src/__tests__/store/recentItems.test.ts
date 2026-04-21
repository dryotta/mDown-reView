import { describe, it, expect, beforeEach } from "vitest";
import { useStore } from "@/store/index";

const initialState = useStore.getState();

beforeEach(() => {
  useStore.setState(initialState, true);
});

describe("recentItems — addRecentItem", () => {
  it("adds a file to recentItems", () => {
    useStore.getState().addRecentItem("/docs/readme.md", "file");
    const items = useStore.getState().recentItems;
    expect(items).toHaveLength(1);
    expect(items[0].path).toBe("/docs/readme.md");
    expect(items[0].type).toBe("file");
    expect(typeof items[0].timestamp).toBe("number");
  });

  it("adds a folder to recentItems", () => {
    useStore.getState().addRecentItem("/workspace/docs", "folder");
    const items = useStore.getState().recentItems;
    expect(items).toHaveLength(1);
    expect(items[0].path).toBe("/workspace/docs");
    expect(items[0].type).toBe("folder");
  });

  it("deduplicates by moving existing item to front", () => {
    useStore.getState().addRecentItem("/a.md", "file");
    useStore.getState().addRecentItem("/b.md", "file");
    useStore.getState().addRecentItem("/a.md", "file");
    const items = useStore.getState().recentItems;
    expect(items).toHaveLength(2);
    expect(items[0].path).toBe("/a.md");
    expect(items[1].path).toBe("/b.md");
  });

  it("evicts oldest item when exceeding max 5", () => {
    for (let i = 1; i <= 6; i++) {
      useStore.getState().addRecentItem(`/file${i}.md`, "file");
    }
    const items = useStore.getState().recentItems;
    expect(items).toHaveLength(5);
    expect(items[0].path).toBe("/file6.md");
    expect(items[4].path).toBe("/file2.md");
    expect(items.find((i) => i.path === "/file1.md")).toBeUndefined();
  });

  it("most recent item is first in the array", () => {
    useStore.getState().addRecentItem("/first.md", "file");
    useStore.getState().addRecentItem("/second.md", "file");
    const items = useStore.getState().recentItems;
    expect(items[0].path).toBe("/second.md");
    expect(items[1].path).toBe("/first.md");
  });
});

describe("closeFolder", () => {
  it("sets root to null", () => {
    useStore.getState().setRoot("/workspace");
    useStore.getState().closeFolder();
    expect(useStore.getState().root).toBeNull();
  });

  it("clears expandedFolders", () => {
    useStore.getState().setRoot("/workspace");
    useStore.getState().setFolderExpanded("/workspace/sub", true);
    useStore.getState().closeFolder();
    expect(useStore.getState().expandedFolders).toEqual({});
  });

  it("keeps open tabs unchanged", () => {
    useStore.getState().setRoot("/workspace");
    useStore.getState().openFile("/workspace/readme.md");
    useStore.getState().closeFolder();
    expect(useStore.getState().tabs).toHaveLength(1);
    expect(useStore.getState().activeTabPath).toBe("/workspace/readme.md");
  });

  it("is a no-op when root is already null", () => {
    useStore.getState().closeFolder();
    expect(useStore.getState().root).toBeNull();
  });
});
