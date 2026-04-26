import { describe, it, expect, beforeEach } from "vitest";
import { useStore, openFilesFromArgs } from "@/store/index";

const initialState = useStore.getState();

beforeEach(() => {
  useStore.setState(initialState, true);
});

// Helper: always call openFilesFromArgs with the current store state
async function callOpenFilesFromArgs(files: string[], folders: string[]) {
  await openFilesFromArgs(files, folders, useStore.getState());
}

describe("openFilesFromArgs – folders", () => {
  it("sets the workspace root to the first folder", async () => {
    await callOpenFilesFromArgs([], ["/workspace/project"]);
    expect(useStore.getState().root).toBe("/workspace/project");
  });

  it("uses the last folder when multiple are supplied", async () => {
    await callOpenFilesFromArgs([], ["/first", "/second"]);
    expect(useStore.getState().root).toBe("/second");
  });

  it("does not set root when no folders are provided", async () => {
    await callOpenFilesFromArgs([], []);
    expect(useStore.getState().root).toBeNull();
  });

  it("resets expandedFolders when root is set via folder arg", async () => {
    useStore.getState().setFolderExpanded("/old/folderA", true);
    await callOpenFilesFromArgs([], ["/new/root"]);
    expect(useStore.getState().expandedFolders).toEqual({});
  });
});

describe("openFilesFromArgs – files", () => {
  it("opens a single file path as a tab", async () => {
    await callOpenFilesFromArgs(["/docs/readme.md"], []);
    const { tabs } = useStore.getState();
    expect(tabs).toHaveLength(1);
    expect(tabs[0].path).toBe("/docs/readme.md");
  });

  it("opens multiple file paths as tabs", async () => {
    await callOpenFilesFromArgs(["/a.md", "/b.md", "/c.md"], []);
    const paths = useStore.getState().tabs.map((t) => t.path);
    expect(paths).toEqual(["/a.md", "/b.md", "/c.md"]);
  });

  it("sets the last opened file as the active tab", async () => {
    await callOpenFilesFromArgs(["/a.md", "/b.md"], []);
    expect(useStore.getState().activeTabPath).toBe("/b.md");
  });

  it("does not open a tab when files array is empty", async () => {
    await callOpenFilesFromArgs([], []);
    expect(useStore.getState().tabs).toHaveLength(0);
  });
});

describe("openFilesFromArgs – deduplication", () => {
  it("skips files that are already open", async () => {
    // Pre-open a file via normal store action
    useStore.getState().openFile("/docs/readme.md");
    expect(useStore.getState().tabs).toHaveLength(1);

    // Now call openFilesFromArgs with the same file — must pass current state
    // so alreadyOpen reflects the pre-opened tab.
    await openFilesFromArgs(["/docs/readme.md"], [], useStore.getState());

    expect(useStore.getState().tabs).toHaveLength(1);
  });

  it("opens only new files when a mix of old and new is supplied", async () => {
    useStore.getState().openFile("/existing.md");

    await openFilesFromArgs(["/existing.md", "/new.md"], [], useStore.getState());

    const paths = useStore.getState().tabs.map((t) => t.path);
    expect(paths).toContain("/existing.md");
    expect(paths).toContain("/new.md");
    expect(paths).toHaveLength(2);
  });

  it("deduplicates files within a single call", async () => {
    await callOpenFilesFromArgs(["/a.md", "/a.md", "/b.md"], []);
    const paths = useStore.getState().tabs.map((t) => t.path);
    expect(paths).toEqual(["/a.md", "/b.md"]);
  });

  it("deduplication works regardless of call order", async () => {
    useStore.getState().openFile("/file.md");

    // Call twice; second call should also see the file as already open
    await openFilesFromArgs(["/file.md"], [], useStore.getState());
    await openFilesFromArgs(["/file.md"], [], useStore.getState());

    expect(useStore.getState().tabs).toHaveLength(1);
  });
});

describe("openFilesFromArgs – files and folders together", () => {
  it("sets root and opens files in the same call", async () => {
    await callOpenFilesFromArgs(["/workspace/notes.md"], ["/workspace"]);
    expect(useStore.getState().root).toBe("/workspace");
    expect(useStore.getState().tabs).toHaveLength(1);
    expect(useStore.getState().tabs[0].path).toBe("/workspace/notes.md");
  });
});

describe("openFilesFromArgs – recent items tracking", () => {
  it("adds opened files to recentItems", async () => {
    await callOpenFilesFromArgs(["/docs/readme.md"], []);
    const items = useStore.getState().recentItems;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ path: "/docs/readme.md", type: "file" });
  });

  it("adds opened folder to recentItems", async () => {
    await callOpenFilesFromArgs([], ["/workspace/project"]);
    const items = useStore.getState().recentItems;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ path: "/workspace/project", type: "folder" });
  });

  it("adds both files and folders to recentItems", async () => {
    await callOpenFilesFromArgs(["/workspace/notes.md"], ["/workspace"]);
    const items = useStore.getState().recentItems;
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.path)).toContain("/workspace");
    expect(items.map((i) => i.path)).toContain("/workspace/notes.md");
  });

  it("uses last folder when multiple folders are supplied", async () => {
    await callOpenFilesFromArgs([], ["/first", "/second"]);
    expect(useStore.getState().root).toBe("/second");
    const items = useStore.getState().recentItems;
    expect(items[0]).toMatchObject({ path: "/second", type: "folder" });
  });
});
