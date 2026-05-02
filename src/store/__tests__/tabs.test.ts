/**
 * Tabs slice — cross-slice action tests for issue #276.
 *
 * Locks down rule 16 (cross-slice action grouping in `docs/architecture.md`):
 * any tab-context-changing action must dismiss the mermaid popout overlay so
 * the user is never left looking at popout content from a no-longer-active
 * file. Tab-internal actions (scroll, view-mode toggle, file-meta cache
 * patches) are explicitly NOT context changes and must NOT close the popout.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { useStore } from "@/store";

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
  it("openFile closes the popout", () => {
    useStore.getState().openMermaidPopout("graph");
    useStore.getState().openFile("/foo.md", { recordHistory: false });
    expect(useStore.getState().mermaidPopoutOpenFor).toBeNull();
  });

  it("closeTab closes the popout", () => {
    useStore.getState().openFile("/foo.md", { recordHistory: false });
    useStore.getState().openMermaidPopout("graph");
    useStore.getState().closeTab("/foo.md");
    expect(useStore.getState().mermaidPopoutOpenFor).toBeNull();
  });

  it("closeAllTabs closes the popout", () => {
    useStore.getState().openMermaidPopout("graph");
    useStore.getState().closeAllTabs();
    expect(useStore.getState().mermaidPopoutOpenFor).toBeNull();
  });

  it("setActiveTab closes the popout", () => {
    useStore.getState().openFile("/foo.md", { recordHistory: false });
    useStore.getState().openFile("/bar.md", { recordHistory: false });
    useStore.getState().openMermaidPopout("graph");
    useStore.getState().setActiveTab("/foo.md", { recordHistory: false });
    expect(useStore.getState().mermaidPopoutOpenFor).toBeNull();
  });

  it("setScrollTop does NOT close the popout", () => {
    useStore.getState().openFile("/foo.md", { recordHistory: false });
    useStore.getState().openMermaidPopout("graph");
    useStore.getState().setScrollTop("/foo.md", 100);
    expect(useStore.getState().mermaidPopoutOpenFor).not.toBeNull();
  });

  it("setViewMode does NOT close the popout (source/visual toggle stays in same file)", () => {
    useStore.getState().openFile("/foo.md", { recordHistory: false });
    useStore.getState().openMermaidPopout("graph");
    useStore.getState().setViewMode("/foo.md", "source");
    expect(useStore.getState().mermaidPopoutOpenFor).not.toBeNull();
  });

  it("setFileMeta does NOT close the popout (metadata cache, not navigation)", () => {
    useStore.getState().openFile("/foo.md", { recordHistory: false });
    useStore.getState().openMermaidPopout("graph");
    useStore.getState().setFileMeta("/foo.md", { sizeBytes: 123 });
    expect(useStore.getState().mermaidPopoutOpenFor).not.toBeNull();
  });
});

describe("setFileMeta slice diff (issue #280, iter 3, group G3)", () => {
  it("returns the same fileMetaByPath reference when patch is field-by-field identical", () => {
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

  it("creates a new fileMetaByPath reference when fileMtime changes", () => {
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

  it("creates a new fileMetaByPath reference for a path with no existing entry", () => {
    const before = useStore.getState().fileMetaByPath;
    expect(before["/new.md"]).toBeUndefined();

    useStore.getState().setFileMeta("/new.md", { sizeBytes: 42 });
    const after = useStore.getState().fileMetaByPath;

    expect(Object.is(before, after)).toBe(false);
    expect(after["/new.md"]?.sizeBytes).toBe(42);
  });
});
