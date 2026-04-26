import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

const mockCloseTab = vi.fn();
const mockCloseAllTabs = vi.fn();
const mockSetActiveTab = vi.fn();
const mockBumpZoom = vi.fn();
const mockBack = vi.fn();
const mockForward = vi.fn();
const mockNextUnresolvedInActiveFile = vi.fn();
const mockPrevUnresolvedInActiveFile = vi.fn();
const mockNextUnresolvedAcrossFiles = vi.fn();
const mockResolveFocusedThread = vi.fn();
const mockActiveViewerContextMenu = vi.fn();

const storeState = {
  activeTabPath: "/a.md",
  closeTab: mockCloseTab,
  closeAllTabs: mockCloseAllTabs,
  setActiveTab: mockSetActiveTab,
  bumpZoom: mockBumpZoom,
  back: mockBack,
  forward: mockForward,
  nextUnresolvedInActiveFile: mockNextUnresolvedInActiveFile,
  prevUnresolvedInActiveFile: mockPrevUnresolvedInActiveFile,
  nextUnresolvedAcrossFiles: mockNextUnresolvedAcrossFiles,
  resolveFocusedThread: mockResolveFocusedThread,
  activeViewerContextMenu: mockActiveViewerContextMenu as
    | ((x: number, y: number) => void)
    | null,
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
  startCommentOnSelection: vi.fn(),
};

function fire(opts: { key: string; shift?: boolean; mod?: boolean; alt?: boolean; target?: EventTarget }) {
  const ev = new KeyboardEvent("keydown", {
    key: opts.key,
    shiftKey: !!opts.shift,
    ctrlKey: opts.mod ?? (opts.alt ? false : true),
    altKey: !!opts.alt,
    cancelable: true,
    bubbles: true,
  });
  if (opts.target) {
    opts.target.dispatchEvent(ev);
  } else {
    window.dispatchEvent(ev);
  }
  return ev;
}

beforeEach(() => {
  vi.clearAllMocks();
  storeState.activeTabPath = "/a.md";
  storeState.zoomByFiletype = {};
  storeState.viewModeByTab = {};
  mockBack.mockReturnValue(null);
  mockForward.mockReturnValue(null);
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

  it("Ctrl+= calls bumpZoom('in') for the active filetype", () => {
    renderHook(() => useGlobalShortcuts(callbacks));
    fire({ key: "=" });
    expect(mockBumpZoom).toHaveBeenCalledWith(".md", "in");
  });

  it("Ctrl+- calls bumpZoom('out')", () => {
    renderHook(() => useGlobalShortcuts(callbacks));
    fire({ key: "-" });
    expect(mockBumpZoom).toHaveBeenCalledWith(".md", "out");
  });

  it("Ctrl+0 calls bumpZoom('reset')", () => {
    renderHook(() => useGlobalShortcuts(callbacks));
    fire({ key: "0" });
    expect(mockBumpZoom).toHaveBeenCalledWith(".md", "reset");
  });

  it("zoom shortcuts use source filetype key when active tab is in source view", () => {
    storeState.viewModeByTab = { "/a.md": "source" };
    renderHook(() => useGlobalShortcuts(callbacks));
    fire({ key: "=" });
    expect(mockBumpZoom.mock.calls[0][0]).toBe(".source");
  });

  it("zoom shortcuts are no-ops when no active tab", () => {
    storeState.activeTabPath = "";
    renderHook(() => useGlobalShortcuts(callbacks));
    fire({ key: "=" });
    fire({ key: "0" });
    expect(mockBumpZoom).not.toHaveBeenCalled();
  });

  // T5 — Alt+Left / Alt+Right back/forward branches.
  describe("Alt+Left / Alt+Right (T5)", () => {
    it("Alt+Left calls back(); switches tab when target returned (no history push)", () => {
      mockBack.mockReturnValue("/b.md");
      renderHook(() => useGlobalShortcuts(callbacks));
      const ev = fire({ key: "ArrowLeft", alt: true, mod: false });
      expect(mockBack).toHaveBeenCalledOnce();
      expect(mockSetActiveTab).toHaveBeenCalledWith("/b.md", { recordHistory: false });
      expect(ev.defaultPrevented).toBe(true);
    });

    it("Alt+Left with no back target is a no-op", () => {
      mockBack.mockReturnValue(null);
      renderHook(() => useGlobalShortcuts(callbacks));
      const ev = fire({ key: "ArrowLeft", alt: true, mod: false });
      expect(mockBack).toHaveBeenCalledOnce();
      expect(mockSetActiveTab).not.toHaveBeenCalled();
      expect(ev.defaultPrevented).toBe(false);
    });

    it("Alt+Right calls forward()", () => {
      mockForward.mockReturnValue("/c.md");
      renderHook(() => useGlobalShortcuts(callbacks));
      fire({ key: "ArrowRight", alt: true, mod: false });
      expect(mockForward).toHaveBeenCalledOnce();
      expect(mockSetActiveTab).toHaveBeenCalledWith("/c.md", { recordHistory: false });
    });

    it("Ctrl+Alt+Left does NOT trigger back (modifier conflict)", () => {
      mockBack.mockReturnValue("/b.md");
      renderHook(() => useGlobalShortcuts(callbacks));
      // alt=true, mod (ctrl)=true → modifier guard rejects.
      fire({ key: "ArrowLeft", alt: true, mod: true });
      expect(mockBack).not.toHaveBeenCalled();
    });
  });

  // F6 — Shift+F10 / ContextMenu key reachability via registered callback.
  describe("F6 keyboard reachability (Shift+F10 / ContextMenu)", () => {
    beforeEach(() => {
      mockActiveViewerContextMenu.mockReset();
      storeState.activeViewerContextMenu = mockActiveViewerContextMenu as
        | ((x: number, y: number) => void)
        | null;
    });

    it("Shift+F10 invokes the registered active-viewer opener", () => {
      renderHook(() => useGlobalShortcuts(callbacks));
      const ev = new KeyboardEvent("keydown", {
        key: "F10",
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      });
      window.dispatchEvent(ev);
      expect(mockActiveViewerContextMenu).toHaveBeenCalledTimes(1);
      const [x, y] = mockActiveViewerContextMenu.mock.calls[0];
      expect(typeof x).toBe("number");
      expect(typeof y).toBe("number");
      expect(ev.defaultPrevented).toBe(true);
    });

    it("ContextMenu key invokes the registered opener", () => {
      renderHook(() => useGlobalShortcuts(callbacks));
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ContextMenu", bubbles: true, cancelable: true }),
      );
      expect(mockActiveViewerContextMenu).toHaveBeenCalledTimes(1);
    });

    it("Shift+F10 is a clean no-op when no viewer is registered", () => {
      storeState.activeViewerContextMenu = null;
      renderHook(() => useGlobalShortcuts(callbacks));
      const ev = new KeyboardEvent("keydown", {
        key: "F10",
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      });
      window.dispatchEvent(ev);
      expect(mockActiveViewerContextMenu).not.toHaveBeenCalled();
      expect(ev.defaultPrevented).toBe(false);
    });
  });

  describe("editable-target guard (B1)", () => {
    it("ignores Ctrl+= when target is an INPUT", () => {
      renderHook(() => useGlobalShortcuts(callbacks));
      const input = document.createElement("input");
      document.body.appendChild(input);
      fire({ key: "=", target: input });
      expect(mockBumpZoom).not.toHaveBeenCalled();
      input.remove();
    });

    it("ignores Alt+Left when target is a TEXTAREA", () => {
      mockBack.mockReturnValue("/b.md");
      renderHook(() => useGlobalShortcuts(callbacks));
      const ta = document.createElement("textarea");
      document.body.appendChild(ta);
      fire({ key: "ArrowLeft", alt: true, mod: false, target: ta });
      expect(mockBack).not.toHaveBeenCalled();
      ta.remove();
    });

    it("ignores Ctrl+W when target is contentEditable", () => {
      renderHook(() => useGlobalShortcuts(callbacks));
      const div = document.createElement("div");
      div.contentEditable = "true";
      document.body.appendChild(div);
      fire({ key: "w", target: div });
      expect(mockCloseTab).not.toHaveBeenCalled();
      div.remove();
    });
  });

  it("removes listener on unmount", () => {
    const { unmount } = renderHook(() => useGlobalShortcuts(callbacks));
    unmount();
    fire({ key: "o" });
    expect(callbacks.handleOpenFile).not.toHaveBeenCalled();
  });

  // F1 — comment navigation/action shortcuts.
  describe("F1 comment shortcuts", () => {
    it("Ctrl+Shift+M calls startCommentOnSelection", () => {
      renderHook(() => useGlobalShortcuts(callbacks));
      const ev = fire({ key: "M", shift: true });
      expect(callbacks.startCommentOnSelection).toHaveBeenCalledOnce();
      expect(ev.defaultPrevented).toBe(true);
    });

    it("J calls nextUnresolvedInActiveFile", () => {
      renderHook(() => useGlobalShortcuts(callbacks));
      const ev = fire({ key: "j", mod: false });
      expect(mockNextUnresolvedInActiveFile).toHaveBeenCalledOnce();
      expect(ev.defaultPrevented).toBe(true);
    });

    it("K calls prevUnresolvedInActiveFile", () => {
      renderHook(() => useGlobalShortcuts(callbacks));
      fire({ key: "k", mod: false });
      expect(mockPrevUnresolvedInActiveFile).toHaveBeenCalledOnce();
    });

    it("N calls nextUnresolvedAcrossFiles", () => {
      renderHook(() => useGlobalShortcuts(callbacks));
      fire({ key: "n", mod: false });
      expect(mockNextUnresolvedAcrossFiles).toHaveBeenCalledOnce();
    });

    it("R calls resolveFocusedThread", () => {
      renderHook(() => useGlobalShortcuts(callbacks));
      fire({ key: "r", mod: false });
      expect(mockResolveFocusedThread).toHaveBeenCalledOnce();
    });

    it("Esc is not bound globally (handled per-input by CommentInput)", () => {
      renderHook(() => useGlobalShortcuts(callbacks));
      const ev = fire({ key: "Escape", mod: false });
      // No global handler should preventDefault on Escape; CommentInput
      // owns Escape on its textarea blur.
      expect(ev.defaultPrevented).toBe(false);
    });

    it("J/K/N/R/Ctrl+Shift+M skip when target is editable", () => {
      renderHook(() => useGlobalShortcuts(callbacks));
      const input = document.createElement("input");
      document.body.appendChild(input);
      fire({ key: "j", mod: false, target: input });
      fire({ key: "k", mod: false, target: input });
      fire({ key: "n", mod: false, target: input });
      fire({ key: "r", mod: false, target: input });
      fire({ key: "M", shift: true, target: input });
      expect(mockNextUnresolvedInActiveFile).not.toHaveBeenCalled();
      expect(mockPrevUnresolvedInActiveFile).not.toHaveBeenCalled();
      expect(mockNextUnresolvedAcrossFiles).not.toHaveBeenCalled();
      expect(mockResolveFocusedThread).not.toHaveBeenCalled();
      expect(callbacks.startCommentOnSelection).not.toHaveBeenCalled();
      input.remove();
    });
  });
});
