import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act, within, waitFor } from "@testing-library/react";
import { SettingsView } from "../SettingsView";
import { useStore } from "@/store";
import { invoke } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core");
vi.mock("@/logger");

const setAuthorMock = vi.fn();
let currentAuthor = "Test User";

vi.mock("@/lib/vm/useAuthor", () => ({
  useAuthor: () => ({ author: currentAuthor, setAuthor: setAuthorMock }),
}));

const mockedInvoke = invoke as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  // jsdom does not implement HTMLDialogElement.showModal / .close.
  // Provide minimal stubs so the <dialog> element receives the `open`
  // attribute and the component's try/catch in useEffect doesn't silently
  // skip the showModal call.
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  });

  useStore.setState({
    settingsDialogOpen: true,
    onboardingStatuses: {
      cliShim: "pending",
      defaultHandler: "pending",
    },
    onboardingErrors: {},
  });
  vi.clearAllMocks();
  currentAuthor = "Test User";
  setAuthorMock.mockReset();
  // Default: every IPC call returns void/undefined. Individual tests override
  // for never-resolving / failing scenarios.
  mockedInvoke.mockImplementation(async () => undefined);
});

const onCloseMock = vi.fn();

describe("SettingsView", () => {
  it("renders a dialog element with Settings title", async () => {
    await act(async () => {
      render(<SettingsView onClose={onCloseMock} />);
    });
    const dialog = document.querySelector("dialog.settings-dialog");
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute("open");
    expect(screen.getByText("Settings")).toBeInTheDocument();
  });

  it("renders 2 integration rows (CLI shim, Default handler)", async () => {
    await act(async () => {
      render(<SettingsView onClose={onCloseMock} />);
    });
    expect(screen.getByTestId("settings-row-cliShim")).toBeInTheDocument();
    expect(screen.getByTestId("settings-row-defaultHandler")).toBeInTheDocument();
    expect(screen.getByText("CLI shim")).toBeInTheDocument();
    expect(screen.getByText("Default handler")).toBeInTheDocument();
  });

  it("each switch has role=switch with aria-checked and aria-busy attributes", async () => {
    await act(async () => {
      render(<SettingsView onClose={onCloseMock} />);
    });
    const switches = screen.getAllByRole("switch");
    expect(switches).toHaveLength(2);
    for (const sw of switches) {
      expect(sw).toHaveAttribute("aria-checked");
      expect(sw).toHaveAttribute("aria-busy");
    }
  });

  it("cancel event on dialog calls onClose (native Esc)", async () => {
    await act(async () => {
      render(<SettingsView onClose={onCloseMock} />);
    });
    const dialog = document.querySelector("dialog.settings-dialog")!;
    await act(async () => {
      fireEvent(dialog, new Event("cancel", { bubbles: true }));
    });
    expect(onCloseMock).toHaveBeenCalled();
  });

  it("Close button calls onClose", async () => {
    await act(async () => {
      render(<SettingsView onClose={onCloseMock} />);
    });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onCloseMock).toHaveBeenCalled();
  });

  it("two parallel toggles run independently — both fire and both rows show pending", async () => {
    // Never-resolving promise: the row stays in-flight, letting us assert
    // that BOTH toggles can be in-flight at the same time (the spec — no
    // global lock between rows).
    const pendingPromise = new Promise<void>(() => {});
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "install_cli_shim" || cmd === "set_default_handler") {
        return pendingPromise;
      }
      return undefined;
    });

    // defaultHandler needs to be non-"done" so the switch renders.
    useStore.setState({
      onboardingStatuses: { cliShim: "pending", defaultHandler: "pending" },
    });

    await act(async () => {
      render(<SettingsView onClose={onCloseMock} />);
    });

    const cliRow = screen.getByTestId("settings-row-cliShim");
    const handlerRow = screen.getByTestId("settings-row-defaultHandler");
    const cliSwitch = within(cliRow).getByRole("switch");
    const handlerSwitch = within(handlerRow).getByRole("switch");

    await act(async () => {
      fireEvent.click(cliSwitch);
      fireEvent.click(handlerSwitch);
    });

    // Both IPC commands were invoked.
    const calls = mockedInvoke.mock.calls.map((c) => c[0]);
    expect(calls).toContain("install_cli_shim");
    expect(calls).toContain("set_default_handler");

    // Both switches show pending state.
    expect(cliSwitch).toHaveAttribute("aria-busy", "true");
    expect(cliSwitch).toBeDisabled();
    expect(handlerSwitch).toHaveAttribute("aria-busy", "true");
    expect(handlerSwitch).toBeDisabled();
  });

  it("when an action is in-flight the switch is disabled and aria-busy=true", async () => {
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "install_cli_shim") return new Promise<void>(() => {});
      return undefined;
    });

    await act(async () => {
      render(<SettingsView onClose={onCloseMock} />);
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
      render(<SettingsView onClose={onCloseMock} />);
    });
    const errorEl = screen.getByTestId("settings-row-error-cliShim");
    expect(errorEl).toHaveTextContent("Permission denied");
  });

  // ── B5: hidden switch + fallback text ────────────────────────────────────

  it('hides the switch and shows fallback text when defaultHandler status is "done" (noop branch — B5)', async () => {
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "default_handler_status") return "done";
      if (cmd === "cli_shim_status") return "missing";
      if (cmd === "onboarding_state")
        return { schema_version: 1, last_seen_sections: [] };
      return undefined;
    });
    await act(async () => {
      render(<SettingsView onClose={onCloseMock} />);
    });
    const row = screen.getByTestId("settings-row-defaultHandler");
    // No switch in this row.
    expect(within(row).queryByRole("switch")).toBeNull();
    // Fallback text rendered instead.
    expect(within(row).getByTestId("settings-row-fallback-defaultHandler"))
      .toHaveTextContent(/Already the default/i);
  });

  it('hides the switch and shows fallback when status is "unsupported" (B5)', async () => {
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "cli_shim_status") return "unsupported";
      if (cmd === "default_handler_status") return "missing";
      if (cmd === "onboarding_state")
        return { schema_version: 1, last_seen_sections: [] };
      return undefined;
    });
    // Drive the status into the store so SettingsView picks it up.
    useStore.setState({
      onboardingStatuses: { cliShim: "unsupported", defaultHandler: "pending" },
    });
    await act(async () => {
      render(<SettingsView onClose={onCloseMock} />);
    });
    const row = screen.getByTestId("settings-row-cliShim");
    expect(within(row).queryByRole("switch")).toBeNull();
    expect(within(row).getByTestId("settings-row-fallback-cliShim"))
      .toHaveTextContent(/Not available on this platform/i);
  });

  it("renders a one-line description under each row label (B5)", async () => {
    await act(async () => {
      render(<SettingsView onClose={onCloseMock} />);
    });
    expect(screen.getByTestId("settings-row-description-cliShim")).toHaveTextContent(/CLI/);
    expect(screen.getByTestId("settings-row-description-defaultHandler")).toHaveTextContent(/default app/);
  });

  // ── B7: mount-side IPC ───────────────────────────────────────────────────

  it("fires onboarding status IPC on mount (B7 regression — must keep view honest)", async () => {
    await act(async () => {
      render(<SettingsView onClose={onCloseMock} />);
    });
    const calls = mockedInvoke.mock.calls.map((c) => c[0]);
    expect(calls).toContain("cli_shim_status");
  });

  // ── Category headings ────────────────────────────────────────────────────

  it('renders "General" and "Integrations" category headings', async () => {
    await act(async () => {
      render(<SettingsView onClose={onCloseMock} />);
    });
    expect(screen.getByText("General")).toBeInTheDocument();
    expect(screen.getByText("Integrations")).toBeInTheDocument();
    expect(screen.getByTestId("settings-category-general")).toBeInTheDocument();
    expect(screen.getByTestId("settings-category-integrations")).toBeInTheDocument();
  });

  // ── Inline display name (author) ─────────────────────────────────────────

  it("renders Display name input with correct label", async () => {
    await act(async () => {
      render(<SettingsView onClose={onCloseMock} />);
    });
    const input = screen.getByLabelText("Display name");
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute("type", "text");
  });

  it("prefills the author input with the current useAuthor value", async () => {
    currentAuthor = "Existing User";
    await act(async () => {
      render(<SettingsView onClose={onCloseMock} />);
    });
    const input = screen.getByLabelText("Display name") as HTMLInputElement;
    expect(input.value).toBe("Existing User");
  });

  it("saves author on blur via setAuthor", async () => {
    setAuthorMock.mockResolvedValueOnce(undefined);
    await act(async () => {
      render(<SettingsView onClose={onCloseMock} />);
    });
    const input = screen.getByLabelText("Display name");
    fireEvent.change(input, { target: { value: "Reviewer-2" } });
    await act(async () => {
      fireEvent.blur(input);
    });
    expect(setAuthorMock).toHaveBeenCalledWith("Reviewer-2");
  });

  it("shows validation error for empty name", async () => {
    setAuthorMock.mockRejectedValueOnce({ kind: "InvalidAuthor", reason: "empty" });
    await act(async () => {
      render(<SettingsView onClose={onCloseMock} />);
    });
    const input = screen.getByLabelText("Display name");
    fireEvent.change(input, { target: { value: "   " } });
    await act(async () => {
      fireEvent.blur(input);
    });
    await waitFor(() => expect(screen.getByText("Name required")).toBeInTheDocument());
  });

  it("shows validation error for too_long", async () => {
    setAuthorMock.mockRejectedValueOnce({ kind: "InvalidAuthor", reason: "too_long" });
    await act(async () => {
      render(<SettingsView onClose={onCloseMock} />);
    });
    const input = screen.getByLabelText("Display name");
    fireEvent.change(input, { target: { value: "x".repeat(200) } });
    await act(async () => {
      fireEvent.blur(input);
    });
    await waitFor(() => expect(screen.getByText(/too long/i)).toBeInTheDocument());
  });

  it("hydrates draft when author resolves after dialog mount (race)", async () => {
    // Reproduce the race: dialog opens BEFORE useAuthor's get_author IPC
    // resolves, so `author` is "" on mount. After the store updates with
    // the resolved value, the input must reflect it.
    currentAuthor = "";
    const { rerender } = await act(async () =>
      render(<SettingsView onClose={onCloseMock} />),
    );
    const input = screen.getByLabelText("Display name") as HTMLInputElement;
    expect(input.value).toBe("");

    // Simulate the IPC resolving and the store hydrating.
    currentAuthor = "alice";
    await act(async () => {
      rerender(<SettingsView onClose={onCloseMock} />);
    });

    await waitFor(() => {
      const refreshed = screen.getByLabelText("Display name") as HTMLInputElement;
      expect(refreshed.value).toBe("alice");
    });
  });
});
