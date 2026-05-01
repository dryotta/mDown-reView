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
