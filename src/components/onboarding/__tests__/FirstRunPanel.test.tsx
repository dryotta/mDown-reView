import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { FirstRunPanel } from "../FirstRunPanel";
import { useStore } from "@/store";

vi.mock("@tauri-apps/api/core");
vi.mock("@/logger");

vi.mock("@/hooks/useAboutInfo", () => ({
  useAboutInfo: () => ({ version: "0.3.4", logPath: "" }),
}));

beforeEach(() => {
  useStore.setState({
    welcomePanelOpen: false,
    setupPanelOpen: false,
    onboardingStatuses: {
      cliShim: "pending",
      defaultHandler: "pending",
      folderContext: "pending",
    },
    onboardingState: null,
    onboardingErrors: {},
  });
  vi.clearAllMocks();
});

describe("FirstRunPanel", () => {
  it("does not render when welcomePanelOpen=false", () => {
    const { container } = render(<FirstRunPanel />);
    expect(container.firstChild).toBeNull();
  });

  it("renders 5 sections (incl. WhatIsThis) when open", async () => {
    useStore.setState({ welcomePanelOpen: true });
    await act(async () => {
      render(<FirstRunPanel />);
    });
    // Dialog title (h2) — same text as the WhatIsThis section h3, so query by role.
    expect(
      screen.getByRole("heading", { level: 2, name: "Welcome to mDown reView" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Command-line tool")).toBeInTheDocument();
    expect(screen.getByText("AI agent integration")).toBeInTheDocument();
    expect(screen.getByText("Open .md files with mdownreview")).toBeInTheDocument();
    expect(screen.getByText("Open folder with mdownreview")).toBeInTheDocument();
  });

  it("'Done' button calls markOnboardingWelcomed with current version then closeWelcome", async () => {
    const markSpy = vi.fn().mockResolvedValue(undefined);
    const closeSpy = vi.fn();
    useStore.setState({
      welcomePanelOpen: true,
      markOnboardingWelcomed: markSpy,
      closeWelcome: closeSpy,
    });
    await act(async () => {
      render(<FirstRunPanel />);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Done" }));
    });
    await waitFor(() => expect(markSpy).toHaveBeenCalledWith("0.3.4"));
    expect(closeSpy).toHaveBeenCalled();
  });

  it("'Skip for now' calls dismissOnboardingWelcome and NOT markOnboardingWelcomed", async () => {
    const markSpy = vi.fn().mockResolvedValue(undefined);
    const dismissSpy = vi.fn();
    useStore.setState({
      welcomePanelOpen: true,
      markOnboardingWelcomed: markSpy,
      dismissOnboardingWelcome: dismissSpy,
    });
    await act(async () => {
      render(<FirstRunPanel />);
    });
    fireEvent.click(screen.getByRole("button", { name: /skip for now/i }));
    expect(dismissSpy).toHaveBeenCalled();
    expect(markSpy).not.toHaveBeenCalled();
  });

  it("title changes to 'What's new' when last_welcomed_version is set", async () => {
    useStore.setState({
      welcomePanelOpen: true,
      onboardingState: {
        schema_version: 1,
        last_welcomed_version: "0.3.3",
        last_seen_sections: [],
      },
    });
    await act(async () => {
      render(<FirstRunPanel />);
    });
    expect(
      screen.getByRole("heading", { level: 2, name: /What's new in v0\.3\.4/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { level: 2, name: "Welcome to mDown reView" }),
    ).toBeNull();
  });
});
