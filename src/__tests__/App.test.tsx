import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { useStore } from "@/store";

// ── window.matchMedia stub (jsdom lacks it) ────────────────────────────────

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("@tauri-apps/api/core");
vi.mock("@/logger");

const eventHandlers: Record<string, (event: { payload: unknown }) => void> = {};
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((event: string, handler: (e: { payload: unknown }) => void) => {
    eventHandlers[event] = handler;
    return Promise.resolve(() => {});
  }),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/tauri-commands", () => ({
  getLaunchArgs: vi.fn().mockResolvedValue({ files: [], folders: [] }),
}));

vi.mock("@/hooks/useFileWatcher", () => ({
  useFileWatcher: () => {},
}));

vi.mock("@/components/FolderTree/FolderTree", () => ({
  FolderTree: () => <div data-testid="folder-tree" />,
}));
vi.mock("@/components/TabBar/TabBar", () => ({
  TabBar: () => <div data-testid="tab-bar" />,
}));
vi.mock("@/components/viewers/ViewerRouter", () => ({
  ViewerRouter: ({ path }: { path: string }) => <div data-testid="viewer-router">{path}</div>,
}));
vi.mock("@/components/comments/CommentsPanel", () => ({
  CommentsPanel: () => <div data-testid="comments-panel" />,
}));
vi.mock("@/components/AboutDialog", () => ({
  AboutDialog: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="about-dialog">
      <button onClick={onClose}>close-about</button>
    </div>
  ),
}));
vi.mock("@/components/ErrorBoundary", () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/UpdateBanner", () => ({
  UpdateBanner: () => null,
}));
vi.mock("@/components/WelcomeView", () => ({
  WelcomeView: () => <div data-testid="welcome-view" />,
}));
vi.mock("@/components/Icons", () => ({
  IconFile: () => <span data-testid="icon-file" />,
  IconFolder: () => <span data-testid="icon-folder" />,
  IconComment: () => <span data-testid="icon-comment" />,
  IconSun: () => <span data-testid="icon-sun" />,
  IconMoon: () => <span data-testid="icon-moon" />,
  IconAuto: () => <span data-testid="icon-auto" />,
  IconInfo: () => <span data-testid="icon-info" />,
}));

import { open } from "@tauri-apps/plugin-dialog";
const mockOpen = open as ReturnType<typeof vi.fn>;

import App from "@/App";

// ── Store reset ────────────────────────────────────────────────────────────

const initialState = useStore.getState();

beforeEach(() => {
  useStore.setState(initialState, true);
  vi.clearAllMocks();
  for (const key of Object.keys(eventHandlers)) {
    delete eventHandlers[key];
  }
});

async function renderApp() {
  await act(async () => {
    render(<App />);
  });
}

// ── Helper: dispatch keyboard shortcut on window ───────────────────────────

function pressKey(opts: {
  key: string;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  metaKey?: boolean;
}) {
  fireEvent.keyDown(window, {
    key: opts.key,
    ctrlKey: opts.ctrlKey ?? false,
    shiftKey: opts.shiftKey ?? false,
    metaKey: opts.metaKey ?? false,
    bubbles: true,
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("App – toolbar rendering", () => {
  it("renders Open File, Open Folder, Comments, theme, and About buttons", async () => {
    await renderApp();

    expect(screen.getByText("Open File")).toBeInTheDocument();
    expect(screen.getByText("Open Folder")).toBeInTheDocument();
    expect(screen.getByText("Comments")).toBeInTheDocument();
    expect(screen.getByText("System")).toBeInTheDocument();
    expect(screen.getByText("About")).toBeInTheDocument();
  });

  it("shows WelcomeView when no active tab", async () => {
    await renderApp();
    expect(screen.getByTestId("welcome-view")).toBeInTheDocument();
  });
});

describe("App – keyboard shortcuts", () => {
  it("Ctrl+O calls open dialog for files", async () => {
    await renderApp();

    await act(async () => {
      pressKey({ key: "o", ctrlKey: true });
    });

    expect(mockOpen).toHaveBeenCalledWith({ directory: false, multiple: true });
  });

  it("Ctrl+Shift+O calls open dialog for folder", async () => {
    await renderApp();

    await act(async () => {
      pressKey({ key: "O", ctrlKey: true, shiftKey: true });
    });

    expect(mockOpen).toHaveBeenCalledWith({ directory: true, multiple: false });
  });

  it("Ctrl+Shift+C toggles comments pane", async () => {
    await renderApp();
    const before = useStore.getState().commentsPaneVisible;

    act(() => {
      pressKey({ key: "C", ctrlKey: true, shiftKey: true });
    });

    expect(useStore.getState().commentsPaneVisible).toBe(!before);
  });

  it("Ctrl+W closes the active tab", async () => {
    useStore.setState({
      tabs: [
        { path: "/a.md", scrollTop: 0 },
        { path: "/b.md", scrollTop: 0 },
      ],
      activeTabPath: "/a.md",
    });

    await renderApp();

    act(() => {
      pressKey({ key: "w", ctrlKey: true });
    });

    const state = useStore.getState();
    expect(state.tabs.map((t) => t.path)).toEqual(["/b.md"]);
    expect(state.activeTabPath).toBe("/b.md");
  });

  it("Ctrl+W with no active tab does nothing", async () => {
    useStore.setState({ tabs: [], activeTabPath: null });
    await renderApp();

    act(() => {
      pressKey({ key: "w", ctrlKey: true });
    });

    expect(useStore.getState().tabs).toEqual([]);
  });

  it("Ctrl+Tab cycles to the next tab", async () => {
    useStore.setState({
      tabs: [
        { path: "/a.md", scrollTop: 0 },
        { path: "/b.md", scrollTop: 0 },
        { path: "/c.md", scrollTop: 0 },
      ],
      activeTabPath: "/a.md",
    });

    await renderApp();

    act(() => {
      pressKey({ key: "Tab", ctrlKey: true });
    });

    expect(useStore.getState().activeTabPath).toBe("/b.md");
  });

  it("Ctrl+Tab wraps around from last to first tab", async () => {
    useStore.setState({
      tabs: [
        { path: "/a.md", scrollTop: 0 },
        { path: "/b.md", scrollTop: 0 },
      ],
      activeTabPath: "/b.md",
    });

    await renderApp();

    act(() => {
      pressKey({ key: "Tab", ctrlKey: true });
    });

    expect(useStore.getState().activeTabPath).toBe("/a.md");
  });

  it("Ctrl+Shift+Tab cycles to the previous tab", async () => {
    useStore.setState({
      tabs: [
        { path: "/a.md", scrollTop: 0 },
        { path: "/b.md", scrollTop: 0 },
        { path: "/c.md", scrollTop: 0 },
      ],
      activeTabPath: "/b.md",
    });

    await renderApp();

    act(() => {
      pressKey({ key: "Tab", ctrlKey: true, shiftKey: true });
    });

    expect(useStore.getState().activeTabPath).toBe("/a.md");
  });

  it("Ctrl+Shift+Tab wraps around from first to last tab", async () => {
    useStore.setState({
      tabs: [
        { path: "/a.md", scrollTop: 0 },
        { path: "/b.md", scrollTop: 0 },
        { path: "/c.md", scrollTop: 0 },
      ],
      activeTabPath: "/a.md",
    });

    await renderApp();

    act(() => {
      pressKey({ key: "Tab", ctrlKey: true, shiftKey: true });
    });

    expect(useStore.getState().activeTabPath).toBe("/c.md");
  });

  it("Ctrl+Tab with fewer than 2 tabs does nothing", async () => {
    useStore.setState({
      tabs: [{ path: "/a.md", scrollTop: 0 }],
      activeTabPath: "/a.md",
    });

    await renderApp();

    act(() => {
      pressKey({ key: "Tab", ctrlKey: true });
    });

    expect(useStore.getState().activeTabPath).toBe("/a.md");
  });

  it("Ctrl+Shift+W closes all tabs", async () => {
    useStore.setState({
      tabs: [
        { path: "/a.md", scrollTop: 0 },
        { path: "/b.md", scrollTop: 0 },
      ],
      activeTabPath: "/a.md",
    });

    await renderApp();

    act(() => {
      pressKey({ key: "W", ctrlKey: true, shiftKey: true });
    });

    expect(useStore.getState().tabs).toEqual([]);
    expect(useStore.getState().activeTabPath).toBeNull();
  });
});

describe("App – theme cycling", () => {
  it("cycles theme: system → light → dark → system", async () => {
    useStore.setState({ theme: "system" });
    await renderApp();

    const themeBtn = screen.getByText("System").closest("button")!;

    act(() => {
      fireEvent.click(themeBtn);
    });
    expect(useStore.getState().theme).toBe("light");

    act(() => {
      fireEvent.click(themeBtn);
    });
    expect(useStore.getState().theme).toBe("dark");

    act(() => {
      fireEvent.click(themeBtn);
    });
    expect(useStore.getState().theme).toBe("system");
  });
});

describe("App – About dialog", () => {
  it("opens About dialog when About button is clicked", async () => {
    await renderApp();

    expect(screen.queryByTestId("about-dialog")).not.toBeInTheDocument();

    act(() => {
      fireEvent.click(screen.getByText("About").closest("button")!);
    });

    expect(screen.getByTestId("about-dialog")).toBeInTheDocument();
  });

  it("closes About dialog via onClose callback", async () => {
    await renderApp();

    act(() => {
      fireEvent.click(screen.getByText("About").closest("button")!);
    });
    expect(screen.getByTestId("about-dialog")).toBeInTheDocument();

    act(() => {
      fireEvent.click(screen.getByText("close-about"));
    });
    expect(screen.queryByTestId("about-dialog")).not.toBeInTheDocument();
  });
});

describe("App – menu event listeners", () => {
  it("menu-open-file event triggers open dialog", async () => {
    await renderApp();

    await act(async () => {
      eventHandlers["menu-open-file"]?.({ payload: undefined });
    });

    expect(mockOpen).toHaveBeenCalledWith({ directory: false, multiple: true });
  });

  it("menu-open-folder event triggers folder dialog", async () => {
    await renderApp();

    await act(async () => {
      eventHandlers["menu-open-folder"]?.({ payload: undefined });
    });

    expect(mockOpen).toHaveBeenCalledWith({ directory: true, multiple: false });
  });

  it("menu-toggle-comments-pane event toggles comments", async () => {
    await renderApp();
    const before = useStore.getState().commentsPaneVisible;

    act(() => {
      eventHandlers["menu-toggle-comments-pane"]?.({ payload: undefined });
    });

    expect(useStore.getState().commentsPaneVisible).toBe(!before);
  });

  it("menu-close-tab event closes the active tab", async () => {
    useStore.setState({
      tabs: [{ path: "/x.md", scrollTop: 0 }],
      activeTabPath: "/x.md",
    });
    await renderApp();

    act(() => {
      eventHandlers["menu-close-tab"]?.({ payload: undefined });
    });

    expect(useStore.getState().tabs).toEqual([]);
  });

  it("menu-next-tab event cycles to next tab", async () => {
    useStore.setState({
      tabs: [
        { path: "/a.md", scrollTop: 0 },
        { path: "/b.md", scrollTop: 0 },
      ],
      activeTabPath: "/a.md",
    });
    await renderApp();

    act(() => {
      eventHandlers["menu-next-tab"]?.({ payload: undefined });
    });

    expect(useStore.getState().activeTabPath).toBe("/b.md");
  });

  it("menu-prev-tab event cycles to previous tab", async () => {
    useStore.setState({
      tabs: [
        { path: "/a.md", scrollTop: 0 },
        { path: "/b.md", scrollTop: 0 },
      ],
      activeTabPath: "/b.md",
    });
    await renderApp();

    act(() => {
      eventHandlers["menu-prev-tab"]?.({ payload: undefined });
    });

    expect(useStore.getState().activeTabPath).toBe("/a.md");
  });

  it("menu-theme-light event sets theme to light", async () => {
    await renderApp();

    act(() => {
      eventHandlers["menu-theme-light"]?.({ payload: undefined });
    });

    expect(useStore.getState().theme).toBe("light");
  });

  it("menu-about event opens the About dialog", async () => {
    await renderApp();

    act(() => {
      eventHandlers["menu-about"]?.({ payload: undefined });
    });

    expect(screen.getByTestId("about-dialog")).toBeInTheDocument();
  });
});
