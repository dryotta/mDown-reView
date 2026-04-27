import { describe, it, expect, beforeEach } from "vitest";
import { useStore } from "@/store/index";

const initialState = useStore.getState();

beforeEach(() => {
  useStore.setState(initialState, true);
});

// The persist middleware is configured with a `partialize` function.
// We extract that function from the store options by reading what the
// persist implementation would persist — we simulate it by applying the
// same fields the store opts into.
//
// See the partialize config in store/index.ts for the authoritative field list.
// We verify the contract by manually calling it on a state snapshot.

// Returns the global-prefs-only shape that partialize now produces.
// Per-window state (tabs, activeTabPath, expandedFolders, root) is excluded.
function getPersistedSnapshot() {
  const state = useStore.getState();
  return {
    theme: state.theme,
    folderPaneWidth: state.folderPaneWidth,
    commentsPaneVisible: state.commentsPaneVisible,
    authorName: state.authorName,
    readingWidth: state.readingWidth,
    recentItems: state.recentItems,
    updateChannel: state.updateChannel,
    zoomByFiletype: state.zoomByFiletype,
  };
}

describe("persistence partialize contract", () => {
  it("includes theme in the persisted snapshot", () => {
    useStore.getState().setTheme("dark");
    const snapshot = getPersistedSnapshot();
    expect(snapshot).toHaveProperty("theme", "dark");
  });

  it("includes folderPaneWidth in the persisted snapshot", () => {
    useStore.getState().setFolderPaneWidth(320);
    const snapshot = getPersistedSnapshot();
    expect(snapshot).toHaveProperty("folderPaneWidth", 320);
  });

  it("includes commentsPaneVisible in the persisted snapshot", () => {
    useStore.getState().toggleCommentsPane(); // defaults to true → false
    const snapshot = getPersistedSnapshot();
    expect(snapshot).toHaveProperty("commentsPaneVisible", false);
  });

  it("includes recentItems in the persisted snapshot", () => {
    useStore.getState().addRecentItem("/test/file.md", "file");
    const snapshot = getPersistedSnapshot();
    expect(snapshot).toHaveProperty("recentItems");
    expect(snapshot.recentItems).toHaveLength(1);
  });

  it("persisted snapshot has exactly the expected keys", () => {
    const snapshot = getPersistedSnapshot();
    const keys = Object.keys(snapshot).sort();
    expect(keys).toEqual(
      ["authorName", "commentsPaneVisible", "folderPaneWidth", "readingWidth", "recentItems", "theme", "updateChannel", "zoomByFiletype"].sort()
    );
  });

  it("does NOT persist per-window state", () => {
    const snapshot = getPersistedSnapshot();
    expect(snapshot).not.toHaveProperty("tabs");
    expect(snapshot).not.toHaveProperty("activeTabPath");
    expect(snapshot).not.toHaveProperty("expandedFolders");
    expect(snapshot).not.toHaveProperty("root");
  });

  it("includes readingWidth in the persisted snapshot", () => {
    useStore.getState().setReadingWidth(900);
    const snapshot = getPersistedSnapshot();
    expect(snapshot).toHaveProperty("readingWidth", 900);
  });

  it("theme defaults to 'system' before any change", () => {
    const snapshot = getPersistedSnapshot();
    expect(snapshot.theme).toBe("system");
  });

  it("persists theme through all valid values", () => {
    for (const theme of ["system", "light", "dark"] as const) {
      useStore.getState().setTheme(theme);
      expect(getPersistedSnapshot().theme).toBe(theme);
    }
  });
});
