import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { useStore } from "@/store";
import type { SettingsSurface } from "@/store";

/**
 * Issue #116 — `settingsSurface` discriminated-union regression test.
 *
 * Asserts the single-surface invariance: for every value of `settingsSurface`
 * AT MOST ONE of `<SettingsView/>` (inline) and `<SettingsDialog/>` (modal)
 * is mounted. The previous shape used two independent booleans
 * (`settingsOpen` + `authorDialogOpen`), which left the door open to
 * co-mounting both surfaces — `<dialog>.showModal()` would then `inert` the
 * inline view.
 *
 * Lint-rule oracle: the synthetic-regression coverage (a fixture asserting
 * that the pre-fix `{settingsOpen && <SettingsView/>}{settingsOpen &&
 * <SettingsDialog/>}` shape produces ≥1 violation) lives in the dedicated
 * RuleTester suite at `eslint-rules/no-shared-boolean-mount.test.js`. That
 * suite IS the synthetic regression — re-introducing the shared-boolean
 * shape in App.tsx fails the lint gate before this DOM-level test runs.
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
  folderContextStatus: vi.fn().mockResolvedValue("missing"),
  onboardingState: vi.fn().mockResolvedValue({ schema_version: 1, last_seen_sections: [] }),
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
  SettingsView: () => <div data-testid="settings-view" />,
}));
vi.mock("@/components/SettingsDialog", () => ({
  SettingsDialog: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="settings-dialog">
      <button onClick={onClose}>close</button>
    </div>
  ),
}));
vi.mock("@/components/Icons", () => ({
  IconFile: () => <span />,
  IconFolder: () => <span />,
  IconComment: () => <span />,
  IconSettings: () => <span />,
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

describe("settingsSurface single-surface invariance (issue #116)", () => {
  // Truth table: exactly one (or zero for 'closed') surface is mounted per value.
  const cases: { surface: SettingsSurface; view: boolean; dialog: boolean }[] = [
    { surface: "closed", view: false, dialog: false },
    { surface: "inline", view: true, dialog: false },
    { surface: "modal", view: false, dialog: true },
  ];

  for (const { surface, view, dialog } of cases) {
    it(`settingsSurface='${surface}' mounts SettingsView=${view}, SettingsDialog=${dialog}`, async () => {
      useStore.setState({ settingsSurface: surface });
      await renderApp();
      expect(Boolean(screen.queryByTestId("settings-view"))).toBe(view);
      expect(Boolean(screen.queryByTestId("settings-dialog"))).toBe(dialog);
      // Hard invariance check: never both at once.
      const both =
        screen.queryByTestId("settings-view") && screen.queryByTestId("settings-dialog");
      expect(both).toBeFalsy();
    });
  }
});
