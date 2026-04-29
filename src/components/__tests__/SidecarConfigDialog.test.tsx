import { describe, it, expect, beforeEach, vi } from "vitest";
import type { MockedFunction } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { SidecarConfigDialog } from "../SidecarConfigDialog";
import { useStore } from "@/store";
import { invoke } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core");
vi.mock("@/logger");

const mockedInvoke = invoke as MockedFunction<typeof invoke>;

const DEFAULT_CONFIG = {
  enabled: false,
  sidecar_root: null,
  count_in_folder: 0,
  count_colocated: 3,
};

const ENABLED_CONFIG = {
  enabled: true,
  sidecar_root: ".reviews",
  count_in_folder: 5,
  count_colocated: 2,
};

beforeEach(() => {
  // jsdom does not implement HTMLDialogElement.showModal / .close.
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  });

  vi.clearAllMocks();
  useStore.setState({ showSidecarFiles: false });

  mockedInvoke.mockImplementation(async (cmd: string) => {
    if (cmd === "get_sidecar_config") return DEFAULT_CONFIG;
    return undefined;
  });
});

const onCloseMock = vi.fn();

describe("SidecarConfigDialog", () => {
  it("renders dialog with correct title", async () => {
    await act(async () => {
      render(<SidecarConfigDialog root="/workspace" onClose={onCloseMock} />);
    });

    const dialog = document.querySelector("dialog.sidecar-config-dialog");
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute("open");
    expect(screen.getByText(".review.yaml Sidecar Config")).toBeInTheDocument();
  });

  it("loads config on mount via get_sidecar_config IPC", async () => {
    await act(async () => {
      render(<SidecarConfigDialog root="/workspace" onClose={onCloseMock} />);
    });

    expect(mockedInvoke).toHaveBeenCalledWith("get_sidecar_config", { root: "/workspace" });
  });

  it("renders toggle in off state when sidecar_root is not configured", async () => {
    await act(async () => {
      render(<SidecarConfigDialog root="/workspace" onClose={onCloseMock} />);
    });

    const toggle = screen.getByRole("switch", { name: /use \.reviews\/ folder/i });
    expect(toggle).toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-checked", "false");
  });

  it("renders toggle in on state when sidecar_root is enabled", async () => {
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "get_sidecar_config") return ENABLED_CONFIG;
      return undefined;
    });

    await act(async () => {
      render(<SidecarConfigDialog root="/workspace" onClose={onCloseMock} />);
    });

    const toggle = screen.getByRole("switch", { name: /use \.reviews\/ folder/i });
    expect(toggle).toHaveAttribute("aria-checked", "true");
  });

  it("calls set_sidecar_config when toggle is clicked", async () => {
    mockedInvoke.mockImplementation(async (cmd, args) => {
      if (cmd === "get_sidecar_config") return DEFAULT_CONFIG;
      if (cmd === "set_sidecar_config") {
        return { ...DEFAULT_CONFIG, enabled: (args as { enabled?: boolean })?.enabled };
      }
      return undefined;
    });

    await act(async () => {
      render(<SidecarConfigDialog root="/workspace" onClose={onCloseMock} />);
    });

    const toggle = screen.getByRole("switch", { name: /use \.reviews\/ folder/i });
    await act(async () => {
      fireEvent.click(toggle);
    });

    expect(mockedInvoke).toHaveBeenCalledWith("set_sidecar_config", {
      root: "/workspace",
      enabled: true,
    });
  });

  it("shows migration counts and button when enabled with co-located files", async () => {
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "get_sidecar_config") return ENABLED_CONFIG;
      return undefined;
    });

    await act(async () => {
      render(<SidecarConfigDialog root="/workspace" onClose={onCloseMock} />);
    });

    // FROM count (co-located = 2)
    expect(screen.getByText("2")).toBeInTheDocument();
    // TO count (.reviews/ = 5)
    expect(screen.getByText("5")).toBeInTheDocument();
    // Migrate button
    const btn = screen.getByText(/Move 2 co-located → \.reviews\//);
    expect(btn).toBeInTheDocument();
    expect(btn).not.toBeDisabled();
  });

  it("disables migrate button when nothing to migrate", async () => {
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "get_sidecar_config") return { ...ENABLED_CONFIG, count_colocated: 0 };
      return undefined;
    });

    await act(async () => {
      render(<SidecarConfigDialog root="/workspace" onClose={onCloseMock} />);
    });

    const btn = screen.getByText(/All review files/);
    expect(btn).toBeDisabled();
  });

  it("calls migrate_sidecars_cmd when migrate button is clicked", async () => {
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "get_sidecar_config") return ENABLED_CONFIG;
      if (cmd === "migrate_sidecars_cmd") {
        return {
          moved: 2,
          failed: [],
          config: { ...ENABLED_CONFIG, count_colocated: 0, count_in_folder: 7 },
        };
      }
      return undefined;
    });

    await act(async () => {
      render(<SidecarConfigDialog root="/workspace" onClose={onCloseMock} />);
    });

    const btn = screen.getByText(/Move 2 co-located → \.reviews\//);
    await act(async () => {
      fireEvent.click(btn);
    });

    expect(mockedInvoke).toHaveBeenCalledWith("migrate_sidecars_cmd", {
      root: "/workspace",
      direction: "to_folder",
    });

    await waitFor(() => {
      expect(screen.getByText(/Moved 2 files/)).toBeInTheDocument();
    });
  });

  it("show sidecar files toggle reads and updates store", async () => {
    await act(async () => {
      render(<SidecarConfigDialog root="/workspace" onClose={onCloseMock} />);
    });

    const toggle = screen.getByRole("switch", { name: /show sidecar files/i });
    expect(toggle).toHaveAttribute("aria-checked", "false");

    await act(async () => {
      fireEvent.click(toggle);
    });

    expect(useStore.getState().showSidecarFiles).toBe(true);
  });

  it("show sidecar files toggle persists across dialog close/reopen", async () => {
    useStore.setState({ showSidecarFiles: true });

    await act(async () => {
      render(<SidecarConfigDialog root="/workspace" onClose={onCloseMock} />);
    });

    const toggle = screen.getByRole("switch", { name: /show sidecar files/i });
    expect(toggle).toHaveAttribute("aria-checked", "true");
  });

  it("clicking close button calls onClose", async () => {
    await act(async () => {
      render(<SidecarConfigDialog root="/workspace" onClose={onCloseMock} />);
    });

    const closeBtn = screen.getByLabelText("Close");
    await act(async () => {
      fireEvent.click(closeBtn);
    });

    expect(onCloseMock).toHaveBeenCalled();
  });
});
