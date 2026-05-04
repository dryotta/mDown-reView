import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { useStore } from "@/store";

/**
 * Issue #160 — Settings dialog mount-gating regression test.
 *
 * Architecture (post-#160): `<SettingsView/>` is a `<dialog>` gated by
 * `settingsDialogOpen`. The old `settingsSurface` discriminated union,
 * the separate `authorDialogOpen` boolean, and the standalone
 * `<SettingsDialog/>` component are all removed — author editing is now
 * inline in SettingsView.
 *
 * Lint-rule oracle: the synthetic-regression coverage (a fixture asserting
 * that the pre-fix `{settingsOpen && <SettingsView/>}{settingsOpen &&
 * <SettingsDialog/>}` shape produces ≥1 violation) lives in the dedicated
 * RuleTester suite at `eslint-rules/no-shared-boolean-mount.test.js`.
 * Each mount site here uses its own gate identifier, satisfying rule 28.
 */

// Same window stubs / mocks as App.test.tsx — kept self-contained so a
// future split of the App test file doesn't accidentally orphan this one.
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

vi.mock("@tauri-apps/api/core");
vi.mock("@/logger");

vi.mock("@/lib/tauri-events", () => ({
  listenEvent: vi.fn(() => Promise.resolve(() => {})),
}));

vi.mock("@/lib/tauri-commands", () => ({
  getLaunchArgs: vi.fn().mockResolvedValue({ files: [], folders: [] }),
  showOpenDialog: vi.fn().mockResolvedValue(null),
  cliShimStatus: vi.fn().mockResolvedValue("missing"),
  defaultHandlerStatus: vi.fn().mockResolvedValue("unknown"),
  onboardingState: vi.fn().mockResolvedValue({ schema_version: 1, last_seen_sections: [] }),
  installCliShim: vi.fn().mockResolvedValue(undefined),
  removeCliShim: vi.fn().mockResolvedValue(undefined),
  setDefaultHandler: vi.fn().mockResolvedValue(undefined),
  getAppVersion: vi.fn().mockResolvedValue("0.0.0-test"),
  getLogPath: vi.fn().mockResolvedValue("/mock/log.log"),
  getAuthor: vi.fn().mockResolvedValue("Test User"),
  setAuthor: vi.fn().mockResolvedValue("Test User"),
  // Issue #264 — runtime tracing fires from App.tsx's mount effect.
  recordStartupPhase: vi.fn().mockResolvedValue(undefined),
  // Iter-15 + iter-16 — multi-window file singleton + close-flush
  // ready gate. Both are awaited from store/App-mount so they must
  // be present even in test surfaces that don't exercise the
  // related flows.
  claimOpenFile: vi.fn().mockResolvedValue({ kind: "claimed" }),
  releaseOpenFile: vi.fn().mockResolvedValue(undefined),
  releaseOpenFiles: vi.fn().mockResolvedValue(undefined),
  closeFlushComplete: vi.fn().mockResolvedValue(undefined),
  markCloseFlushReady: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/hooks/useFileWatcher", () => ({ useFileWatcher: () => {} }));

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
vi.mock("@/components/AboutDialog", () => ({ AboutDialog: () => null }));
vi.mock("@/components/ErrorBoundary", () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/UpdateBanner", () => ({ UpdateBanner: () => null }));
vi.mock("@/components/WelcomeView", () => ({
  WelcomeView: () => <div data-testid="welcome-view" />,
}));
vi.mock("@/components/SettingsView", () => ({
  SettingsView: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="settings-view">
      <button onClick={onClose}>close</button>
    </div>
  ),
}));
vi.mock("@/components/Icons", () => ({
  IconFile: () => <span />,
  IconFolder: () => <span />,
  IconComment: () => <span />,
}));

import App from "@/App";

const initialState = useStore.getState();

beforeEach(() => {
  useStore.setState(initialState, true);
  vi.clearAllMocks();
});

async function renderApp() {
  await act(async () => {
    render(<App />);
  });
}

describe("settings dialog mount gating (issue #160)", () => {
  // SettingsView gating depends on settingsDialogOpen.
  const viewCases = [
    { open: false, view: false },
    { open: true, view: true },
  ];

  for (const { open, view } of viewCases) {
    it(`settingsDialogOpen=${open} mounts SettingsView=${view}`, async () => {
      useStore.setState({ settingsDialogOpen: open });
      await renderApp();
      expect(Boolean(screen.queryByTestId("settings-view"))).toBe(view);
    });
  }

  // AC6 synthetic-regression mirror: the spec asks for a test that fails when
  // a shared boolean is re-introduced. The runtime can no longer express the
  // pre-fix shape (settingsOpen was deleted), so we co-locate a lint-rule
  // verification here so a future test-file split keeps the AC6 oracle
  // adjacent to the App regression. Authoritative copy lives in
  // eslint-rules/no-shared-boolean-mount.test.js.
  it("AC6 synthetic regression: pre-fix shared-boolean shape trips lint rule 28", async () => {
    const { Linter } = await import("eslint");
    const rule = (await import("../../eslint-rules/no-shared-boolean-mount.js" as string)).default;
    const linter = new Linter();
    const code =
      "const X = () => <div>{settingsOpen && <SettingsView/>}{settingsOpen && <SettingsDialog/>}</div>;";
    const messages = linter.verify(code, {
      plugins: { local: { rules: { "no-shared-boolean-mount": rule } } },
      rules: { "local/no-shared-boolean-mount": "error" },
      languageOptions: {
        parserOptions: { ecmaVersion: 2022, sourceType: "module", ecmaFeatures: { jsx: true } },
      },
    });
    expect(messages.filter((m) => m.ruleId === "local/no-shared-boolean-mount")).toHaveLength(2);
  });
});
