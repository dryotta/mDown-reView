import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { SetupPanel } from "../SetupPanel";
import { useStore } from "@/store";

vi.mock("@tauri-apps/api/core");
vi.mock("@/logger");

beforeEach(() => {
  useStore.setState({
    welcomePanelOpen: false,
    setupPanelOpen: false,
    onboardingStatuses: {
      cliShim: "pending",
      defaultHandler: "pending",
      folderContext: "pending",
    },
    onboardingErrors: {},
  });
  vi.clearAllMocks();
});

describe("SetupPanel", () => {
  it("does not render when setupPanelOpen=false", () => {
    const { container } = render(<SetupPanel />);
    expect(container.firstChild).toBeNull();
  });

  it("renders 4 sections (does NOT include WhatIsThis)", async () => {
    useStore.setState({ setupPanelOpen: true });
    await act(async () => {
      render(<SetupPanel />);
    });
    expect(screen.getByText("Setup")).toBeInTheDocument();
    expect(screen.getByText("Command-line tool")).toBeInTheDocument();
    expect(screen.getByText("AI agent integration")).toBeInTheDocument();
    expect(screen.getByText("Open .md files with mdownreview")).toBeInTheDocument();
    expect(screen.getByText("Open folder with mdownreview")).toBeInTheDocument();
    expect(screen.queryByText("Welcome to mDown reView")).toBeNull();
  });

  it("'Close' button calls closeSetup", async () => {
    const closeSpy = vi.fn();
    useStore.setState({ setupPanelOpen: true, closeSetup: closeSpy });
    await act(async () => {
      render(<SetupPanel />);
    });
    fireEvent.click(screen.getByText("Close", { selector: "button" }));
    expect(closeSpy).toHaveBeenCalled();
  });
});
