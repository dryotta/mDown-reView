import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { AboutDialog } from "../AboutDialog";
import { useStore } from "@/store";

vi.mock("@tauri-apps/api/core");
vi.mock("@/logger");

// Mock useAboutInfo hook
vi.mock("@/hooks/useAboutInfo", () => ({
  useAboutInfo: vi.fn(),
}));

import { useAboutInfo } from "@/hooks/useAboutInfo";
const mockUseAboutInfo = vi.mocked(useAboutInfo);

// Mock useUpdateActions (checkForUpdate is now in VM hook)
const mockCheckForUpdate = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/vm/use-update-actions", () => ({
  useUpdateActions: () => ({ checkForUpdate: mockCheckForUpdate, install: vi.fn() }),
}));

// Mock clipboard plugin
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  writeText: vi.fn().mockResolvedValue(undefined),
}));

import { writeText } from "@tauri-apps/plugin-clipboard-manager";
const mockWriteText = writeText as ReturnType<typeof vi.fn>;

const LOG_PATH = "/home/user/.local/share/mdownreview/app.log";

beforeEach(() => {
  vi.clearAllMocks();
  mockCheckForUpdate.mockClear();
  mockUseAboutInfo.mockReturnValue({ version: "0.2.2", logPath: LOG_PATH });
});

// ─── 14.4: AboutDialog ───────────────────────────────────────────────────────

describe("14.4 – AboutDialog", () => {
  it("renders version text", async () => {
    await act(async () => {
      render(<AboutDialog onClose={vi.fn()} />);
    });
    expect(screen.getByText(/Version 0\.2\.2/)).toBeInTheDocument();
  });

  it("renders log path from mocked getLogPath", async () => {
    await act(async () => {
      render(<AboutDialog onClose={vi.fn()} />);
    });

    expect(screen.getByText(LOG_PATH)).toBeInTheDocument();
  });

  it("shows 'Loading…' before log path resolves", () => {
    mockUseAboutInfo.mockReturnValue({ version: "", logPath: "" });

    render(<AboutDialog onClose={vi.fn()} />);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  it("shows 'Unavailable' when getLogPath rejects", async () => {
    mockUseAboutInfo.mockReturnValue({ version: "0.2.2", logPath: "Unavailable" });

    await act(async () => {
      render(<AboutDialog onClose={vi.fn()} />);
    });

    expect(screen.getByText("Unavailable")).toBeInTheDocument();
  });

  it("'Copy path' button calls clipboard writeText with log path", async () => {
    await act(async () => {
      render(<AboutDialog onClose={vi.fn()} />);
    });

    expect(screen.getByText(LOG_PATH)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /copy path/i }));

    await waitFor(() => {
      expect(mockWriteText).toHaveBeenCalledWith(LOG_PATH);
    });
  });

  it("'Copy path' shows 'Copied!' after click", async () => {
    await act(async () => {
      render(<AboutDialog onClose={vi.fn()} />);
    });

    fireEvent.click(screen.getByRole("button", { name: /copy path/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /copied!/i })).toBeInTheDocument();
    });
  });

  it("'Copy path' button is disabled when logPath is empty", () => {
    mockUseAboutInfo.mockReturnValue({ version: "", logPath: "" });

    render(<AboutDialog onClose={vi.fn()} />);

    const copyBtn = screen.getByRole("button", { name: /copy path/i });
    expect(copyBtn).toBeDisabled();
  });

  it("onClose is called when close button is clicked", async () => {
    const onClose = vi.fn();
    await act(async () => {
      render(<AboutDialog onClose={onClose} />);
    });

    fireEvent.click(screen.getByRole("button", { name: "×" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("renders update channel dropdown defaulting to stable", async () => {
    useStore.setState({ updateChannel: "stable" });
    await act(async () => {
      render(<AboutDialog onClose={vi.fn()} />);
    });

    const select = screen.getByLabelText("Update channel") as HTMLSelectElement;
    expect(select).toBeInTheDocument();
    expect(select.value).toBe("stable");
  });

  it("shows canary warning when canary is selected", async () => {
    useStore.setState({ updateChannel: "canary" });
    await act(async () => {
      render(<AboutDialog onClose={vi.fn()} />);
    });

    expect(screen.getByText(/Canary builds are untested/)).toBeInTheDocument();
  });

  it("does not show canary warning when stable is selected", async () => {
    useStore.setState({ updateChannel: "stable" });
    await act(async () => {
      render(<AboutDialog onClose={vi.fn()} />);
    });

    expect(screen.queryByText(/Canary builds are untested/)).not.toBeInTheDocument();
  });

  it("shows canary badge when version has a numeric pre-release suffix", async () => {
    mockUseAboutInfo.mockReturnValue({ version: "0.3.4-2", logPath: LOG_PATH });
    await act(async () => {
      render(<AboutDialog onClose={vi.fn()} />);
    });

    expect(screen.getByText("canary")).toBeInTheDocument();
  });

  it("does not show canary badge for a stable version", async () => {
    mockUseAboutInfo.mockReturnValue({ version: "0.3.4", logPath: LOG_PATH });
    await act(async () => {
      render(<AboutDialog onClose={vi.fn()} />);
    });

    expect(screen.queryByText("canary")).not.toBeInTheDocument();
  });

  it("calls checkForUpdate from VM when channel is changed", async () => {
    useStore.setState({ updateChannel: "stable" });
    await act(async () => {
      render(<AboutDialog onClose={vi.fn()} />);
    });

    const select = screen.getByLabelText("Update channel") as HTMLSelectElement;
    await act(async () => {
      fireEvent.change(select, { target: { value: "canary" } });
    });

    expect(mockCheckForUpdate).toHaveBeenCalledWith("canary");
  });
});
