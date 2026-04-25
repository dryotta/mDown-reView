import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

const mockCloseTab = vi.fn();
const mockCloseAllTabs = vi.fn();
const mockSetActiveTab = vi.fn();
const mockSetZoom = vi.fn();

const storeState = {
  activeTabPath: "/a.md",
  closeTab: mockCloseTab,
  closeAllTabs: mockCloseAllTabs,
  setActiveTab: mockSetActiveTab,
  setZoom: mockSetZoom,
  zoomByFiletype: {} as Record<string, number>,
  viewModeByTab: {} as Record<string, "source" | "visual">,
  tabs: [
    { path: "/a.md", title: "a" },
    { path: "/b.md", title: "b" },
    { path: "/c.md", title: "c" },
  ],
};

vi.mock("@/store", () => ({
  useStore: { getState: () => storeState },
}));

vi.mock("@/logger", () => ({
  error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), trace: vi.fn(),
}));

import { useGlobalShortcuts } from "../useGlobalShortcuts";

const callbacks = {
  handleOpenFile: vi.fn(),
  handleOpenFolder: vi.fn(),
  toggleCommentsPane: vi.fn(),
};

function fire(opts: { key: string; shift?: boolean; mod?: boolean }) {
  const ev = new KeyboardEvent("keydown", {
    key: opts.key,
    shiftKey: !!opts.shift,
    ctrlKey: opts.mod ?? true,
    cancelable: true,
  });
  window.dispatchEvent(ev);
  return ev;
}

beforeEach(() => {
  vi.clearAllMocks();
  storeState.activeTabPath = "/a.md";
  storeState.zoomByFiletype = {};
  storeState.viewModeByTab = {};
});

describe("useGlobalShortcuts", () => {
  it("Ctrl+O fires handleOpenFile and prevents default", () => {
    renderHook(() => useGlobalShortcuts(callbacks));
    const ev = fire({ key: "o" });
    expect(callbacks.handleOpenFile).toHaveBeenCalledOnce();
    expect(ev.defaultPrevented).toBe(true);
  });

  it("Ctrl+Shift+O fires handleOpenFolder", () => {
    renderHook(() => useGlobalShortcuts(callbacks));
    fire({ key: "O", shift: true });
    expect(callbacks.handleOpenFolder).toHaveBeenCalledOnce();
  });

  it("Ctrl+Shift+C fires toggleCommentsPane", () => {
    renderHook(() => useGlobalShortcuts(callbacks));
    fire({ key: "C", shift: true });
    expect(callbacks.toggleCommentsPane).toHaveBeenCalledOnce();
  });

  it("Ctrl+W closes the active tab", () => {
    renderHook(() => useGlobalShortcuts(callbacks));
    fire({ key: "w" });
    expect(mockCloseTab).toHaveBeenCalledWith("/a.md");
  });

  it("Ctrl+W is a no-op when no active tab", () => {
    storeState.activeTabPath = "";
    renderHook(() => useGlobalShortcuts(callbacks));
    fire({ key: "w" });
    expect(mockCloseTab).not.toHaveBeenCalled();
  });

  it("Ctrl+Shift+W closes all tabs", () => {
    renderHook(() => useGlobalShortcuts(callbacks));
    fire({ key: "W", shift: true });
    expect(mockCloseAllTabs).toHaveBeenCalledOnce();
  });

  it("Ctrl+Tab moves to next tab", () => {
    renderHook(() => useGlobalShortcuts(callbacks));
    fire({ key: "Tab" });
    expect(mockSetActiveTab).toHaveBeenCalledWith("/b.md");
  });

  it("Ctrl+Shift+Tab moves to previous tab (wrapping)", () => {
    renderHook(() => useGlobalShortcuts(callbacks));
    fire({ key: "Tab", shift: true });
    // active is /a.md (idx 0), prev wraps to /c.md
    expect(mockSetActiveTab).toHaveBeenCalledWith("/c.md");
  });

  it("Ctrl+Tab is a no-op when fewer than 2 tabs", () => {
    storeState.tabs = [{ path: "/a.md", title: "a" }];
    renderHook(() => useGlobalShortcuts(callbacks));
    fire({ key: "Tab" });
    expect(mockSetActiveTab).not.toHaveBeenCalled();
    storeState.tabs = [
      { path: "/a.md", title: "a" },
      { path: "/b.md", title: "b" },
      { path: "/c.md", title: "c" },
    ];
  });

  it("ignores keys without modifier", () => {
    renderHook(() => useGlobalShortcuts(callbacks));
    const ev = new KeyboardEvent("keydown", { key: "o", ctrlKey: false, metaKey: false });
    window.dispatchEvent(ev);
    expect(callbacks.handleOpenFile).not.toHaveBeenCalled();
  });

  it("Ctrl+= zooms in the active filetype", () => {
    renderHook(() => useGlobalShortcuts(callbacks));
    fire({ key: "=" });
    expect(mockSetZoom).toHaveBeenCalledTimes(1);
    const [filetype, zoom] = mockSetZoom.mock.calls[0];
    expect(filetype).toBe(".md");
    expect(zoom).toBeCloseTo(1.1, 5);
  });

  it("Ctrl+- zooms out the active filetype", () => {
    renderHook(() => useGlobalShortcuts(callbacks));
    fire({ key: "-" });
    expect(mockSetZoom).toHaveBeenCalledOnce();
    const [filetype, zoom] = mockSetZoom.mock.calls[0];
    expect(filetype).toBe(".md");
    expect(zoom).toBeCloseTo(1 / 1.1, 5);
  });

  it("Ctrl+0 resets the active filetype zoom to 1.0", () => {
    storeState.zoomByFiletype = { ".md": 2.5 };
    renderHook(() => useGlobalShortcuts(callbacks));
    fire({ key: "0" });
    expect(mockSetZoom).toHaveBeenCalledWith(".md", 1.0);
  });

  it("zoom shortcuts use source filetype key when active tab is in source view", () => {
    storeState.viewModeByTab = { "/a.md": "source" };
    renderHook(() => useGlobalShortcuts(callbacks));
    fire({ key: "=" });
    expect(mockSetZoom.mock.calls[0][0]).toBe(".source");
  });

  it("zoom shortcuts are no-ops when no active tab", () => {
    storeState.activeTabPath = "";
    renderHook(() => useGlobalShortcuts(callbacks));
    fire({ key: "=" });
    fire({ key: "0" });
    expect(mockSetZoom).not.toHaveBeenCalled();
  });

  it("removes listener on unmount", () => {
    const { unmount } = renderHook(() => useGlobalShortcuts(callbacks));
    unmount();
    fire({ key: "o" });
    expect(callbacks.handleOpenFile).not.toHaveBeenCalled();
  });
});
