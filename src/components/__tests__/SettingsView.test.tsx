import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act, within } from "@testing-library/react";
import { SettingsView } from "../SettingsView";
import { useStore } from "@/store";
import { invoke } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core");
vi.mock("@/logger");

const mockedInvoke = invoke as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  useStore.setState({
    settingsOpen: true,
    onboardingStatuses: {
      cliShim: "pending",
      defaultHandler: "pending",
      folderContext: "pending",
    },
    onboardingErrors: {},
  });
  vi.clearAllMocks();
  // Default: every IPC call returns void/undefined. Individual tests override
  // for never-resolving / failing scenarios.
  mockedInvoke.mockImplementation(async () => undefined);
});

describe("SettingsView", () => {
  it('renders root region with aria-label "Settings"', async () => {
    await act(async () => {
      render(<SettingsView />);
    });
    const region = screen.getByRole("region", { name: "Settings" });
    expect(region).toBeInTheDocument();
  });

  it("renders 3 integration rows (CLI shim, Default handler, Folder context)", async () => {
    await act(async () => {
      render(<SettingsView />);
    });
    expect(screen.getByTestId("settings-row-cliShim")).toBeInTheDocument();
    expect(screen.getByTestId("settings-row-defaultHandler")).toBeInTheDocument();
    expect(screen.getByTestId("settings-row-folderContext")).toBeInTheDocument();
    expect(screen.getByText("CLI shim")).toBeInTheDocument();
    expect(screen.getByText("Default handler")).toBeInTheDocument();
    expect(screen.getByText("Folder context")).toBeInTheDocument();
  });

  it("each switch has role=switch with aria-checked and aria-busy attributes", async () => {
    await act(async () => {
      render(<SettingsView />);
    });
    const switches = screen.getAllByRole("switch");
    expect(switches).toHaveLength(3);
    for (const sw of switches) {
      expect(sw).toHaveAttribute("aria-checked");
      expect(sw).toHaveAttribute("aria-busy");
    }
  });

  it("Esc keydown calls closeSettings on the store", async () => {
    await act(async () => {
      render(<SettingsView />);
    });
    expect(useStore.getState().settingsOpen).toBe(true);
    await act(async () => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
    expect(useStore.getState().settingsOpen).toBe(false);
  });

  it("Close button calls closeSettings", async () => {
    await act(async () => {
      render(<SettingsView />);
    });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(useStore.getState().settingsOpen).toBe(false);
  });

  it("two parallel toggles run independently — both fire and both rows show pending", async () => {
    // Never-resolving promise: the row stays in-flight, letting us assert
    // that BOTH toggles can be in-flight at the same time (the spec — no
    // global lock between rows).
    const pendingPromise = new Promise<void>(() => {});
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "install_cli_shim" || cmd === "register_folder_context") {
        return pendingPromise;
      }
      return undefined;
    });

    await act(async () => {
      render(<SettingsView />);
    });

    const cliRow = screen.getByTestId("settings-row-cliShim");
    const folderRow = screen.getByTestId("settings-row-folderContext");
    const cliSwitch = within(cliRow).getByRole("switch");
    const folderSwitch = within(folderRow).getByRole("switch");

    await act(async () => {
      fireEvent.click(cliSwitch);
      fireEvent.click(folderSwitch);
    });

    // Both IPC commands were invoked.
    const calls = mockedInvoke.mock.calls.map((c) => c[0]);
    expect(calls).toContain("install_cli_shim");
    expect(calls).toContain("register_folder_context");

    // Both switches show pending state.
    expect(cliSwitch).toHaveAttribute("aria-busy", "true");
    expect(cliSwitch).toBeDisabled();
    expect(folderSwitch).toHaveAttribute("aria-busy", "true");
    expect(folderSwitch).toBeDisabled();
  });

  it("when an action is in-flight the switch is disabled and aria-busy=true", async () => {
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "install_cli_shim") return new Promise<void>(() => {});
      return undefined;
    });

    await act(async () => {
      render(<SettingsView />);
    });

    const cliSwitch = within(screen.getByTestId("settings-row-cliShim")).getByRole("switch");
    expect(cliSwitch).toHaveAttribute("aria-busy", "false");
    expect(cliSwitch).not.toBeDisabled();

    await act(async () => {
      fireEvent.click(cliSwitch);
    });

    expect(cliSwitch).toHaveAttribute("aria-busy", "true");
    expect(cliSwitch).toBeDisabled();
  });

  it("renders the formatted error text for a row with errors[key]", async () => {
    useStore.setState({
      onboardingErrors: { cliShim: "Permission denied" },
    });
    await act(async () => {
      render(<SettingsView />);
    });
    const errorEl = screen.getByTestId("settings-row-error-cliShim");
    expect(errorEl).toHaveTextContent("Permission denied");
  });

  it("renders no modal-backdrop / overlay (full-page view, not a dialog)", async () => {
    const { container } = await act(async () => render(<SettingsView />));
    expect(container.querySelector(".modal-backdrop")).toBeNull();
    expect(container.querySelector(".onboarding-overlay")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
