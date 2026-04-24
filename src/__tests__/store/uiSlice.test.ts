import { describe, it, expect, beforeEach } from "vitest";
import { useStore } from "@/store/index";

const initialState = useStore.getState();

beforeEach(() => {
  useStore.setState(initialState, true);
});

describe("uiSlice — setAuthorName", () => {
  it("defaults to empty string", () => {
    expect(useStore.getState().authorName).toBe("");
  });

  it("sets a name", () => {
    useStore.getState().setAuthorName("Alice");
    expect(useStore.getState().authorName).toBe("Alice");
  });

  it("sets back to empty string", () => {
    useStore.getState().setAuthorName("Bob");
    useStore.getState().setAuthorName("");
    expect(useStore.getState().authorName).toBe("");
  });
});

describe("uiSlice — toggleAutoReveal", () => {
  it("defaults to true", () => {
    expect(useStore.getState().autoReveal).toBe(true);
  });

  it("toggles from true to false", () => {
    useStore.getState().toggleAutoReveal();
    expect(useStore.getState().autoReveal).toBe(false);
  });

  it("toggles from false back to true", () => {
    useStore.getState().toggleAutoReveal();
    useStore.getState().toggleAutoReveal();
    expect(useStore.getState().autoReveal).toBe(true);
  });
});

describe("uiSlice — toggleCommentsPane", () => {
  it("defaults to true", () => {
    expect(useStore.getState().commentsPaneVisible).toBe(true);
  });

  it("toggles from true to false", () => {
    useStore.getState().toggleCommentsPane();
    expect(useStore.getState().commentsPaneVisible).toBe(false);
  });

  it("toggles from false back to true", () => {
    useStore.getState().toggleCommentsPane();
    useStore.getState().toggleCommentsPane();
    expect(useStore.getState().commentsPaneVisible).toBe(true);
  });
});

describe("uiSlice — setTheme", () => {
  it("defaults to system", () => {
    expect(useStore.getState().theme).toBe("system");
  });

  it("sets to light", () => {
    useStore.getState().setTheme("light");
    expect(useStore.getState().theme).toBe("light");
  });

  it("sets to dark", () => {
    useStore.getState().setTheme("dark");
    expect(useStore.getState().theme).toBe("dark");
  });

  it("sets to system", () => {
    useStore.getState().setTheme("dark");
    useStore.getState().setTheme("system");
    expect(useStore.getState().theme).toBe("system");
  });
});

describe("uiSlice — setFolderPaneWidth", () => {
  it("defaults to 240", () => {
    expect(useStore.getState().folderPaneWidth).toBe(240);
  });

  it("sets to a custom width", () => {
    useStore.getState().setFolderPaneWidth(320);
    expect(useStore.getState().folderPaneWidth).toBe(320);
  });

  it("sets to a small width", () => {
    useStore.getState().setFolderPaneWidth(100);
    expect(useStore.getState().folderPaneWidth).toBe(100);
  });
});
