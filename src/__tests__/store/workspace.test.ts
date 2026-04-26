import { describe, it, expect, beforeEach } from "vitest";
import { useStore } from "@/store/index";

// Capture the initial state shape once so we can reset to it between tests.
const initialState = useStore.getState();

beforeEach(() => {
  useStore.setState(initialState, true);
});

describe("workspace slice – setRoot", () => {
  it("updates the root path", async () => {
    await useStore.getState().setRoot("/home/user/docs");
    expect(useStore.getState().root).toBe("/home/user/docs");
  });

  it("accepts null to clear the root", async () => {
    await useStore.getState().setRoot("/some/path");
    await useStore.getState().setRoot(null);
    expect(useStore.getState().root).toBeNull();
  });

  it("resets expandedFolders to an empty object when a new root is set", async () => {
    // Expand some folders first
    useStore.getState().setFolderExpanded("/some/path/folderA", true);
    useStore.getState().setFolderExpanded("/some/path/folderB", true);
    expect(Object.keys(useStore.getState().expandedFolders).length).toBe(2);

    // Switching to a new root should wipe the folder tree
    await useStore.getState().setRoot("/other/path");
    expect(useStore.getState().expandedFolders).toEqual({});
  });

  it("resets expandedFolders even when setting root to null", async () => {
    useStore.getState().setFolderExpanded("/a/folder", true);
    await useStore.getState().setRoot(null);
    expect(useStore.getState().expandedFolders).toEqual({});
  });

  it("does not affect tabs or comments when root changes", async () => {
    useStore.getState().openFile("/some/file.md");
    await useStore.getState().setRoot("/new/root");
    expect(useStore.getState().tabs).toHaveLength(1);
  });
});

describe("workspace slice – toggleFolder / setFolderExpanded", () => {
  it("toggleFolder expands a collapsed folder", () => {
    useStore.getState().toggleFolder("/a/folder");
    expect(useStore.getState().expandedFolders["/a/folder"]).toBe(true);
  });

  it("toggleFolder collapses an expanded folder", () => {
    useStore.getState().setFolderExpanded("/a/folder", true);
    useStore.getState().toggleFolder("/a/folder");
    expect(useStore.getState().expandedFolders["/a/folder"]).toBe(false);
  });

  it("setFolderExpanded sets a folder to the given boolean", () => {
    useStore.getState().setFolderExpanded("/a/folder", true);
    expect(useStore.getState().expandedFolders["/a/folder"]).toBe(true);
    useStore.getState().setFolderExpanded("/a/folder", false);
    expect(useStore.getState().expandedFolders["/a/folder"]).toBe(false);
  });
});
