import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { TabBar } from "../TabBar";
import { useStore } from "@/store";

vi.mock("@tauri-apps/api/core");
vi.mock("@/logger");

// Mock the hook to avoid IPC / event listener setup in tests
vi.mock("@/hooks/useFileBadges", () => ({
  useFileBadges: () => ({}),
}));

const initialState = useStore.getState();

beforeEach(() => {
  useStore.setState(initialState, true);
});

function setup(tabs: { path: string; scrollTop?: number }[], activeTabPath: string | null) {
  useStore.setState({
    tabs: tabs.map((t) => ({ path: t.path, scrollTop: t.scrollTop ?? 0 })),
    activeTabPath,
  });
  return render(<TabBar />);
}

// ─── 8.1: Tab display ────────────────────────────────────────────────────────

describe("8.1 – tab display", () => {
  it("shows file base name in each tab", () => {
    setup(
      [
        { path: "/docs/README.md" },
        { path: "/docs/notes.txt" },
      ],
      "/docs/README.md"
    );

    expect(screen.getByText("README.md")).toBeInTheDocument();
    expect(screen.getByText("notes.txt")).toBeInTheDocument();
  });

  it("active tab has .active class", () => {
    setup([{ path: "/docs/README.md" }, { path: "/docs/notes.txt" }], "/docs/README.md");

    const tabs = screen.getAllByRole("tab");
    const activeTab = tabs.find((t) => t.classList.contains("active"))!;
    expect(activeTab).toBeDefined();
    expect(activeTab).toHaveTextContent("README.md");
  });

  it("title attribute contains full path", () => {
    setup([{ path: "/docs/README.md" }], "/docs/README.md");

    const tab = screen.getByRole("tab");
    expect(tab).toHaveAttribute("title", "/docs/README.md");
  });

  it("renders nothing when tabs array is empty", () => {
    setup([], null);
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
  });
});

// ─── 8.2: Tab interactions and badges ────────────────────────────────────────

describe("8.2 – tab interactions and unresolved comment badge", () => {
  it("clicking an inactive tab calls setActiveTab", () => {
    setup(
      [{ path: "/docs/README.md" }, { path: "/docs/notes.txt" }],
      "/docs/README.md"
    );

    const notesTab = screen.getByRole("tab", { name: /notes\.txt/ });
    fireEvent.click(notesTab);

    expect(useStore.getState().activeTabPath).toBe("/docs/notes.txt");
  });

  it("clicking close × button calls closeTab", () => {
    setup([{ path: "/docs/README.md" }, { path: "/docs/notes.txt" }], "/docs/README.md");

    const closeBtn = screen.getByRole("button", { name: "Close README.md" });
    fireEvent.click(closeBtn);

    const paths = useStore.getState().tabs.map((t) => t.path);
    expect(paths).not.toContain("/docs/README.md");
  });
});

// ─── Chevron overflow + auto-scroll behavior ────────────────────────────────

/**
 * Force the scroll container into a given scroll geometry.
 * jsdom doesn't lay anything out, so we have to stub the read-only
 * scroll/client/offset properties.
 */
function setScrollGeometry(
  container: HTMLElement,
  geom: { scrollLeft: number; scrollWidth: number; clientWidth: number }
) {
  Object.defineProperty(container, "scrollLeft", { configurable: true, value: geom.scrollLeft, writable: true });
  Object.defineProperty(container, "scrollWidth", { configurable: true, value: geom.scrollWidth });
  Object.defineProperty(container, "clientWidth", { configurable: true, value: geom.clientWidth });
}

describe("TabBar – chevron overflow buttons", () => {
  it("hides both chevrons when tabs fit (no overflow)", () => {
    setup([{ path: "/a.md" }, { path: "/b.md" }], "/a.md");
    expect(screen.queryByRole("button", { name: /scroll tabs left/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /scroll tabs right/i })).not.toBeInTheDocument();
  });

  it("shows right chevron when scrolled at start with overflow", () => {
    setup([{ path: "/a.md" }, { path: "/b.md" }, { path: "/c.md" }], "/a.md");
    const container = screen.getByRole("tablist");
    setScrollGeometry(container, { scrollLeft: 0, scrollWidth: 1000, clientWidth: 300 });
    act(() => {
      fireEvent.scroll(container);
    });
    expect(screen.queryByRole("button", { name: /scroll tabs left/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /scroll tabs right/i })).toBeInTheDocument();
  });

  it("shows both chevrons when scrolled in the middle", () => {
    setup([{ path: "/a.md" }, { path: "/b.md" }, { path: "/c.md" }], "/a.md");
    const container = screen.getByRole("tablist");
    setScrollGeometry(container, { scrollLeft: 200, scrollWidth: 1000, clientWidth: 300 });
    act(() => {
      fireEvent.scroll(container);
    });
    expect(screen.getByRole("button", { name: /scroll tabs left/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /scroll tabs right/i })).toBeInTheDocument();
  });

  it("shows only left chevron when scrolled to end", () => {
    setup([{ path: "/a.md" }, { path: "/b.md" }, { path: "/c.md" }], "/a.md");
    const container = screen.getByRole("tablist");
    setScrollGeometry(container, { scrollLeft: 700, scrollWidth: 1000, clientWidth: 300 });
    act(() => {
      fireEvent.scroll(container);
    });
    expect(screen.getByRole("button", { name: /scroll tabs left/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /scroll tabs right/i })).not.toBeInTheDocument();
  });

  it("clicking the right chevron calls scrollBy on the container", () => {
    setup([{ path: "/a.md" }, { path: "/b.md" }, { path: "/c.md" }], "/a.md");
    const container = screen.getByRole("tablist");
    setScrollGeometry(container, { scrollLeft: 0, scrollWidth: 1000, clientWidth: 300 });
    act(() => {
      fireEvent.scroll(container);
    });
    const scrollBySpy = vi.fn();
    container.scrollBy = scrollBySpy;

    fireEvent.click(screen.getByRole("button", { name: /scroll tabs right/i }));
    expect(scrollBySpy).toHaveBeenCalledWith(expect.objectContaining({ left: expect.any(Number) }));
    expect(scrollBySpy.mock.calls[0][0].left).toBeGreaterThan(0);
  });

  it("clicking the left chevron scrolls in the negative direction", () => {
    setup([{ path: "/a.md" }, { path: "/b.md" }, { path: "/c.md" }], "/a.md");
    const container = screen.getByRole("tablist");
    setScrollGeometry(container, { scrollLeft: 200, scrollWidth: 1000, clientWidth: 300 });
    act(() => {
      fireEvent.scroll(container);
    });
    const scrollBySpy = vi.fn();
    container.scrollBy = scrollBySpy;

    fireEvent.click(screen.getByRole("button", { name: /scroll tabs left/i }));
    expect(scrollBySpy.mock.calls[0][0].left).toBeLessThan(0);
  });
});

describe("TabBar – auto-scroll active tab into view", () => {
  function makeTabSpy() {
    // jsdom doesn't implement scrollIntoView; define it before spying.
    if (!(HTMLElement.prototype as unknown as { scrollIntoView?: unknown }).scrollIntoView) {
      (HTMLElement.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {};
    }
    return vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(() => {});
  }

  it("calls scrollIntoView on the active tab when activeTabPath changes", () => {
    const spy = makeTabSpy();
    const { rerender } = setup(
      [{ path: "/a.md" }, { path: "/b.md" }, { path: "/c.md" }],
      "/a.md"
    );
    spy.mockClear(); // ignore initial mount

    // Force the tab to be considered out-of-view.
    const container = screen.getByRole("tablist");
    setScrollGeometry(container, { scrollLeft: 0, scrollWidth: 1000, clientWidth: 100 });
    // Stub b.md tab geometry: starts at 200, width 150 → outside [0, 100].
    const tabB = screen.getByRole("tab", { name: /b\.md/ });
    Object.defineProperty(tabB, "offsetParent", { configurable: true, get: () => container });
    Object.defineProperty(tabB, "offsetLeft", { configurable: true, value: 200 });
    Object.defineProperty(tabB, "offsetWidth", { configurable: true, value: 150 });

    act(() => {
      useStore.setState({ activeTabPath: "/b.md" });
    });
    rerender(<TabBar />);

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ behavior: "instant", block: "nearest", inline: "nearest" })
    );
  });

  it("does NOT call scrollIntoView when the active tab is already visible", () => {
    const spy = makeTabSpy();
    const { rerender } = setup(
      [{ path: "/a.md" }, { path: "/b.md" }],
      "/a.md"
    );
    spy.mockClear();

    const container = screen.getByRole("tablist");
    setScrollGeometry(container, { scrollLeft: 0, scrollWidth: 400, clientWidth: 400 });
    const tabB = screen.getByRole("tab", { name: /b\.md/ });
    Object.defineProperty(tabB, "offsetParent", { configurable: true, get: () => container });
    Object.defineProperty(tabB, "offsetLeft", { configurable: true, value: 100 });
    Object.defineProperty(tabB, "offsetWidth", { configurable: true, value: 100 });

    act(() => {
      useStore.setState({ activeTabPath: "/b.md" });
    });
    rerender(<TabBar />);

    expect(spy).not.toHaveBeenCalled();
  });

  it("does NOT call scrollIntoView when the active tab is not laid out (offsetParent null)", () => {
    const spy = makeTabSpy();
    const { rerender } = setup([{ path: "/a.md" }, { path: "/b.md" }], "/a.md");
    spy.mockClear();

    const tabB = screen.getByRole("tab", { name: /b\.md/ });
    Object.defineProperty(tabB, "offsetParent", { configurable: true, get: () => null });

    act(() => {
      useStore.setState({ activeTabPath: "/b.md" });
    });
    rerender(<TabBar />);

    expect(spy).not.toHaveBeenCalled();
  });

  it("does NOT call scrollIntoView when only the tabs array changes (same active tab)", () => {
    const spy = makeTabSpy();
    const { rerender } = setup([{ path: "/a.md" }, { path: "/b.md" }], "/a.md");
    spy.mockClear();

    // Add another tab; active tab is unchanged.
    act(() => {
      useStore.setState({
        tabs: [
          { path: "/a.md", scrollTop: 0 },
          { path: "/b.md", scrollTop: 0 },
          { path: "/c.md", scrollTop: 0 },
        ],
      });
    });
    rerender(<TabBar />);

    expect(spy).not.toHaveBeenCalled();
  });
});
