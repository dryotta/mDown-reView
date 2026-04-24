import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { UpdateBanner } from "./UpdateBanner";
import { useStore } from "@/store";

vi.mock("@tauri-apps/api/core");
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));
vi.mock("@/logger");
vi.mock("@/lib/tauri-commands", () => ({
  installUpdate: vi.fn().mockResolvedValue(undefined),
}));


beforeEach(() => {
  useStore.setState({
    updateStatus: "idle",
    updateVersion: null,
    updateProgress: 0,
  });
});

describe("UpdateBanner", () => {
  it("renders nothing when status is idle", () => {
    const { container } = render(<UpdateBanner />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when status is checking", () => {
    useStore.setState({ updateStatus: "checking" });
    const { container } = render(<UpdateBanner />);
    expect(container.firstChild).toBeNull();
  });

  it("shows version and Install button when update is available", () => {
    useStore.setState({ updateStatus: "available", updateVersion: "1.2.3" });
    render(<UpdateBanner />);
    expect(screen.getByText("v1.2.3 available")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Install" })).toBeInTheDocument();
  });

  it("shows download progress bar when downloading", () => {
    useStore.setState({ updateStatus: "downloading", updateProgress: 42 });
    render(<UpdateBanner />);
    expect(screen.getByText("Downloading update… 42%")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
  });

  it("shows restart button when ready", () => {
    useStore.setState({ updateStatus: "ready" });
    render(<UpdateBanner />);
    expect(screen.getByText("Restart to apply update")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restart Now" })).toBeInTheDocument();
  });

  it("dismiss button resets status to idle", async () => {
    useStore.setState({ updateStatus: "available", updateVersion: "1.2.3" });
    render(<UpdateBanner />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Dismiss update" }));
    expect(useStore.getState().updateStatus).toBe("idle");
  });
});
