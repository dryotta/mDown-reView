import { describe, it, expect, beforeEach, vi } from "vitest";
import type { MockedFunction } from "vitest";
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

const mockedInvoke = invoke as MockedFunction<typeof invoke>;

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
    defaultHandlerRawStatus: "unknown",
    onboardingErrors: {},
  });
  vi.clearAllMocks();
  currentAuthor = "Test User";
  setAuthorMock.mockReset();
  // Default: every IPC call returns void/undefined. Individual tests override
  // for never-resolving / failing scenarios.
  mockedInvoke.mockImplementation(async () => undefined);

  // Stub clipboard API for copy-button tests.
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
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

  it("renders CLI shim row with AI-agent framing label", async () => {
    await act(async () => {
      render(<SettingsView onClose={onCloseMock} />);
    });
    expect(screen.getByTestId("settings-row-cliShim")).toBeInTheDocument();
    expect(screen.getByText(/Add.*mdownreview-cli.*to your PATH/)).toBeInTheDocument();
  });

  it("renders default handler row as an action button (not a switch)", async () => {
    await act(async () => {
      render(<SettingsView onClose={onCloseMock} />);
    });
    expect(screen.getByTestId("settings-row-defaultHandler")).toBeInTheDocument();
    expect(screen.getByText(/Default app for/)).toBeInTheDocument();
    // No switch in the default handler row.
    const row = screen.getByTestId("settings-row-defaultHandler");
    expect(within(row).queryByRole("switch")).toBeNull();
    // Action button present.
    expect(within(row).getByText("Open system settings")).toBeInTheDocument();
  });

  it("CLI switch has role=switch with aria-checked and aria-busy attributes", async () => {
    await act(async () => {
      render(<SettingsView onClose={onCloseMock} />);
    });
    const switches = screen.getAllByRole("switch");
    // Only CLI shim is a switch now; defaultHandler is an action button.
    expect(switches).toHaveLength(1);
    expect(switches[0]).toHaveAttribute("aria-checked");
    expect(switches[0]).toHaveAttribute("aria-busy");
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

  // ── AC 4: CLI row AI-agent framing ──────────────────────────────────────

  it('CLI row shows AI-agent description when status is "missing" (contains "coding agents")', async () => {
    useStore.setState({
      onboardingStatuses: { cliShim: "pending", defaultHandler: "pending" },
    });
    await act(async () => {
      render(<SettingsView onClose={onCloseMock} />);
    });
    const desc = screen.getByTestId("settings-row-description-cliShim");
    expect(desc).toHaveTextContent(/coding agents/);
    expect(desc).toHaveTextContent(/mdownreview-cli read/);
  });

  it('CLI row shows "on your PATH" description when status is "done"', async () => {
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "cli_shim_status") return "done";
      return undefined;
    });
    useStore.setState({
      onboardingStatuses: { cliShim: "done", defaultHandler: "pending" },
    });
    await act(async () => {
      render(<SettingsView onClose={onCloseMock} />);
    });
    const desc = screen.getByTestId("settings-row-description-cliShim");
    expect(desc).toHaveTextContent(/on your PATH/);
    expect(desc).toHaveTextContent(/agent skills can find it/);
  });

  it("no badge elements render for switch rows", async () => {
    await act(async () => {
      render(<SettingsView onClose={onCloseMock} />);
    });
    const cliRow = screen.getByTestId("settings-row-cliShim");
    expect(within(cliRow).queryByTestId("settings-row-badge-cliShim")).toBeNull();
  });

  // ── AC 5: Agent skills info card ────────────────────────────────────────

  it("agent skills info card renders with plugin commands", async () => {
    await act(async () => {
      render(<SettingsView onClose={onCloseMock} />);
    });
    expect(screen.getByTestId("settings-row-agentSkills")).toBeInTheDocument();
    expect(screen.getByText("Install agent skills")).toBeInTheDocument();
    const codeBlock = screen.getByTestId("settings-agent-skills-code");
    expect(codeBlock).toHaveTextContent(/plugin marketplace add/);
    expect(codeBlock).toHaveTextContent(/plugin install mdownreview/);
  });

  it("copy button in agent skills card calls navigator.clipboard.writeText", async () => {
    await act(async () => {
      render(<SettingsView onClose={onCloseMock} />);
    });
    const copyBtn = screen.getByTestId("settings-copy-btn");
    expect(copyBtn).toHaveTextContent("Copy");

    await act(async () => {
      fireEvent.click(copyBtn);
    });

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining("/plugin marketplace add")
    );
    expect(copyBtn).toHaveTextContent("Copied!");
  });

  // ── AC 6: Default handler action row ────────────────────────────────────

  it('default handler row shows "Open system settings" button', async () => {
    await act(async () => {
      render(<SettingsView onClose={onCloseMock} />);
    });
    const row = screen.getByTestId("settings-row-defaultHandler");
    const btn = within(row).getByTestId("settings-action-btn-defaultHandler");
    expect(btn).toHaveTextContent("Open system settings");
  });

  it('default handler row shows status hint "Currently mdownreview" when done', async () => {
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "default_handler_status") return "done";
      return undefined;
    });
    useStore.setState({ defaultHandlerRawStatus: "done" });
    await act(async () => {
      render(<SettingsView onClose={onCloseMock} />);
    });
    const hint = screen.getByTestId("settings-status-hint-defaultHandler");
    expect(hint).toHaveTextContent(/Currently mdownreview/);
  });

  it('default handler row shows "Currently another app" when status is "other"', async () => {
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "default_handler_status") return "other";
      return undefined;
    });
    useStore.setState({ defaultHandlerRawStatus: "other" });
    await act(async () => {
      render(<SettingsView onClose={onCloseMock} />);
    });
    const hint = screen.getByTestId("settings-status-hint-defaultHandler");
    expect(hint).toHaveTextContent("Currently another app");
  });

  it("default handler row hides button when unsupported", async () => {
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "default_handler_status") return "unsupported";
      return undefined;
    });
    useStore.setState({ defaultHandlerRawStatus: "unsupported" });
    await act(async () => {
      render(<SettingsView onClose={onCloseMock} />);
    });
    const row = screen.getByTestId("settings-row-defaultHandler");
    expect(within(row).queryByTestId("settings-action-btn-defaultHandler")).toBeNull();
    const hint = screen.getByTestId("settings-status-hint-defaultHandler");
    expect(hint).toHaveTextContent("Not available on this platform");
  });

  it("default handler action button invokes setDefaultHandler", async () => {
    const setDefaultHandlerMock = vi.fn().mockResolvedValue(undefined);
    useStore.setState({ setDefaultHandler: setDefaultHandlerMock });
    await act(async () => {
      render(<SettingsView onClose={onCloseMock} />);
    });
    const btn = screen.getByTestId("settings-action-btn-defaultHandler");
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(setDefaultHandlerMock).toHaveBeenCalled();
  });

  // ── B5: hidden switch + fallback text ────────────────────────────────────

  it('hides the switch and shows fallback when cliShim status is "unsupported" (B5)', async () => {
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "cli_shim_status") return "unsupported";
      if (cmd === "default_handler_status") return "unknown";
      if (cmd === "onboarding_state") return { schema_version: 1, last_seen_sections: [] };
      return undefined;
    });
    useStore.setState({
      onboardingStatuses: { cliShim: "unsupported", defaultHandler: "pending" },
    });
    await act(async () => {
      render(<SettingsView onClose={onCloseMock} />);
    });
    const row = screen.getByTestId("settings-row-cliShim");
    expect(within(row).queryByRole("switch")).toBeNull();
    expect(within(row).getByTestId("settings-row-fallback-cliShim")).toHaveTextContent(
      /Not available on this platform/i
    );
  });

  it("renders a one-line description under each row label (B5)", async () => {
    await act(async () => {
      render(<SettingsView onClose={onCloseMock} />);
    });
    expect(screen.getByTestId("settings-row-description-cliShim")).toHaveTextContent(
      /coding agents/
    );
    expect(screen.getByTestId("settings-row-defaultHandler")).toHaveTextContent(/markdown files/);
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

  it('renders "General", "AI Integration", and "File Associations" category headings', async () => {
    await act(async () => {
      render(<SettingsView onClose={onCloseMock} />);
    });
    expect(screen.getByText("General")).toBeInTheDocument();
    expect(screen.getByText("AI Integration")).toBeInTheDocument();
    expect(screen.getByText("File Associations")).toBeInTheDocument();
    expect(screen.getByTestId("settings-category-general")).toBeInTheDocument();
    expect(screen.getByTestId("settings-category-ai-integration")).toBeInTheDocument();
    expect(screen.getByTestId("settings-category-file-associations")).toBeInTheDocument();
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
    const { rerender } = await act(async () => render(<SettingsView onClose={onCloseMock} />));
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
