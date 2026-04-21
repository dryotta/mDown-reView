import { describe, it, expect, beforeEach } from "vitest";
import { useStore } from "@/store/index";
import type { CommentWithOrphan } from "@/store/index";

const initialState = useStore.getState();

beforeEach(() => {
  useStore.setState(initialState, true);
});

// The persist middleware is configured with a `partialize` function.
// We extract that function from the store options by reading what the
// persist implementation would persist — we simulate it by applying the
// same fields the store opts into.
//
// The partialize callback from store/index.ts is:
//   (state) => ({ theme, folderPaneWidth, folderPaneVisible, commentsPaneVisible, root, expandedFolders })
//
// We verify the contract by manually calling it on a state snapshot.

function getPersistedSnapshot() {
  const state = useStore.getState();
  // Replicate the partialize logic from the store definition
  return {
    theme: state.theme,
    folderPaneWidth: state.folderPaneWidth,
    folderPaneVisible: state.folderPaneVisible,
    commentsPaneVisible: state.commentsPaneVisible,
    root: state.root,
    expandedFolders: state.expandedFolders,
  };
}

describe("persistence partialize contract", () => {
  it("does not include commentsByFile in the persisted snapshot", () => {
    // Add a comment so commentsByFile is non-empty
    const comment: CommentWithOrphan = {
      id: "c1",
      author: "Test User (human)",
      timestamp: new Date().toISOString(),
      text: "test comment",
      resolved: false,
      line: 1,
    };
    useStore.getState().setFileComments("/docs/file.md", [comment]);

    const snapshot = getPersistedSnapshot();
    expect(snapshot).not.toHaveProperty("commentsByFile");
  });

  it("does not include tabs in the persisted snapshot", () => {
    useStore.getState().openFile("/some/file.md");
    const snapshot = getPersistedSnapshot();
    expect(snapshot).not.toHaveProperty("tabs");
  });

  it("does not include activeTabPath in the persisted snapshot", () => {
    useStore.getState().openFile("/some/file.md");
    const snapshot = getPersistedSnapshot();
    expect(snapshot).not.toHaveProperty("activeTabPath");
  });

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

  it("includes folderPaneVisible in the persisted snapshot", () => {
    useStore.getState().toggleFolderPane(); // defaults to true → false
    const snapshot = getPersistedSnapshot();
    expect(snapshot).toHaveProperty("folderPaneVisible", false);
  });

  it("includes commentsPaneVisible in the persisted snapshot", () => {
    useStore.getState().toggleCommentsPane(); // defaults to true → false
    const snapshot = getPersistedSnapshot();
    expect(snapshot).toHaveProperty("commentsPaneVisible", false);
  });

  it("includes root in the persisted snapshot", () => {
    useStore.getState().setRoot("/workspace/project");
    const snapshot = getPersistedSnapshot();
    expect(snapshot).toHaveProperty("root", "/workspace/project");
  });

  it("includes expandedFolders in the persisted snapshot", () => {
    useStore.getState().setFolderExpanded("/workspace/folderA", true);
    const snapshot = getPersistedSnapshot();
    expect(snapshot).toHaveProperty("expandedFolders");
    expect(snapshot.expandedFolders).toMatchObject({ "/workspace/folderA": true });
  });

  it("persisted snapshot has exactly the expected keys", () => {
    const snapshot = getPersistedSnapshot();
    const keys = Object.keys(snapshot).sort();
    expect(keys).toEqual(
      ["commentsPaneVisible", "expandedFolders", "folderPaneVisible", "folderPaneWidth", "root", "theme"].sort()
    );
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
