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

const eventHandlers: Record<string, (payload: unknown) => void> = {};
vi.mock("@/lib/tauri-events", () => ({
  listenEvent: vi.fn((event: string, handler: (p: unknown) => void) => {
    eventHandlers[event] = handler;
    return Promise.resolve(() => {});
  }),
}));

vi.mock("@/lib/tauri-commands", () => ({
  getLaunchArgs: vi.fn().mockResolvedValue({ files: [], folders: [] }),
  showOpenDialog: vi.fn().mockResolvedValue(null),
  cliShimStatus: vi.fn().mockResolvedValue("missing"),
  defaultHandlerStatus: vi.fn().mockResolvedValue("unknown"),
  folderContextStatus: vi.fn().mockResolvedValue("missing"),
  onboardingState: vi.fn().mockResolvedValue({
    schema_version: 1,
    last_seen_sections: [],
  }),
  installCliShim: vi.fn().mockResolvedValue(undefined),
  removeCliShim: vi.fn().mockResolvedValue(undefined),
  setDefaultHandler: vi.fn().mockResolvedValue(undefined),
  registerFolderContext: vi.fn().mockResolvedValue(undefined),
  unregisterFolderContext: vi.fn().mockResolvedValue(undefined),
  getAppVersion: vi.fn().mockResolvedValue("0.0.0-test"),
  getLogPath: vi.fn().mockResolvedValue("/mock/log.log"),
  getAuthor: vi.fn().mockResolvedValue("Test User"),
  setAuthor: vi.fn().mockResolvedValue("Test User"),
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
vi.mock("@/components/StatusBar/StatusBar", () => ({
  StatusBar: () => <div data-testid="status-bar" />,
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
vi.mock("@/components/SettingsView", () => ({
  SettingsView: () => <div data-testid="settings-view" />,
}));
vi.mock("@/components/Icons", () => ({
  IconFile: () => <span data-testid="icon-file" />,
  IconFolder: () => <span data-testid="icon-folder" />,
  IconComment: () => <span data-testid="icon-comment" />,
  IconSettings: () => <span data-testid="icon-settings" />,
}));

import { showOpenDialog } from "@/lib/tauri-commands";
const mockOpen = vi.mocked(showOpenDialog);

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
  it("renders Open File, Open Folder, Comments, and Settings buttons; Theme/About buttons removed", async () => {
    await renderApp();

    expect(screen.getByText("Open File")).toBeInTheDocument();
    expect(screen.getByText("Open Folder")).toBeInTheDocument();
    expect(screen.getByText("Comments")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Settings" })).toBeInTheDocument();
    expect(screen.queryByText("System")).not.toBeInTheDocument();
    expect(screen.queryByText("About")).not.toBeInTheDocument();
  });

  it("shows WelcomeView when no active tab", async () => {
    await renderApp();
    expect(screen.getByTestId("welcome-view")).toBeInTheDocument();
  });

  it("renders SettingsView (not WelcomeView) when no active tab and settingsOpen=true", async () => {
    useStore.setState({ settingsOpen: true });
    await renderApp();
    expect(screen.getByTestId("settings-view")).toBeInTheDocument();
    expect(screen.queryByTestId("welcome-view")).not.toBeInTheDocument();
  });

  it("renders WelcomeView (no SettingsView) when no active tab and settingsOpen=false", async () => {
    useStore.setState({ settingsOpen: false });
    await renderApp();
    expect(screen.getByTestId("welcome-view")).toBeInTheDocument();
    expect(screen.queryByTestId("settings-view")).not.toBeInTheDocument();
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

describe("App – About dialog", () => {
  it("opens About dialog via menu-about event", async () => {
    await renderApp();

    expect(screen.queryByTestId("about-dialog")).not.toBeInTheDocument();

    await act(async () => {
      eventHandlers["menu-about"]?.(undefined);
    });

    expect(screen.getByTestId("about-dialog")).toBeInTheDocument();
  });

  it("closes About dialog via onClose callback", async () => {
    await renderApp();

    await act(async () => {
      eventHandlers["menu-about"]?.(undefined);
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
      eventHandlers["menu-open-file"]?.(undefined);
    });

    expect(mockOpen).toHaveBeenCalledWith({ directory: false, multiple: true });
  });

  it("menu-open-folder event triggers folder dialog", async () => {
    await renderApp();

    await act(async () => {
      eventHandlers["menu-open-folder"]?.(undefined);
    });

    expect(mockOpen).toHaveBeenCalledWith({ directory: true, multiple: false });
  });

  it("menu-toggle-comments-pane event toggles comments", async () => {
    await renderApp();
    const before = useStore.getState().commentsPaneVisible;

    act(() => {
      eventHandlers["menu-toggle-comments-pane"]?.(undefined);
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
      eventHandlers["menu-close-tab"]?.(undefined);
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
      eventHandlers["menu-next-tab"]?.(undefined);
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
      eventHandlers["menu-prev-tab"]?.(undefined);
    });

    expect(useStore.getState().activeTabPath).toBe("/a.md");
  });

  it("menu-theme-light event sets theme to light", async () => {
    await renderApp();

    act(() => {
      eventHandlers["menu-theme-light"]?.(undefined);
    });

    expect(useStore.getState().theme).toBe("light");
  });

  it("menu-about event opens the About dialog", async () => {
    await renderApp();

    act(() => {
      eventHandlers["menu-about"]?.(undefined);
    });

    expect(screen.getByTestId("about-dialog")).toBeInTheDocument();
  });
});
