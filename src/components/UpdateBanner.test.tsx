import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { UpdateBanner } from "./UpdateBanner";
import { useStore } from "@/store";
import { restartApp } from "@/lib/tauri-commands";
import { warn } from "@/logger";

vi.mock("@tauri-apps/api/core");
vi.mock("@/lib/tauri-events", () => ({
  listenEvent: vi.fn().mockResolvedValue(() => {}),
}));
vi.mock("@/logger");

const mockInstall = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/vm/use-update-actions", () => ({
  useUpdateActions: () => ({ install: mockInstall }),
}));

// Partial mock — `restartApp` is the only post-install Tauri call we need
// to drive (success default + rejection path for the regression guard
// against the missing `tauri-plugin-process` registration class of bug).
// Spreading `actual` keeps the rest of the IPC façade live so a future
// `restartApp`-adjacent import in this component (e.g., `getAppVersion`
// for telemetry-on-update) doesn't silently become `undefined`.
vi.mock("@/lib/tauri-commands", async () => {
  const actual = await vi.importActual<typeof import("@/lib/tauri-commands")>(
    "@/lib/tauri-commands"
  );
  return { ...actual, restartApp: vi.fn() };
});

beforeEach(() => {
  useStore.setState({
    updateStatus: "idle",
    updateVersion: null,
    updateProgress: 0,
  });
  vi.mocked(restartApp).mockReset();
  vi.mocked(restartApp).mockResolvedValue(undefined);
  vi.mocked(warn).mockClear();
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

  it("clicking Restart Now invokes restartApp and does not show fallback", async () => {
    useStore.setState({ updateStatus: "ready" });
    render(<UpdateBanner />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Restart Now" }));
    expect(restartApp).toHaveBeenCalledTimes(1);
    // Negative oracle: success path must not flip into the fallback UI.
    expect(screen.queryByTestId("update-banner-fallback")).not.toBeInTheDocument();
    expect(warn).not.toHaveBeenCalled();
  });

  // Regression guard: when the `plugin:process|restart` IPC rejects (e.g.
  // tauri-plugin-process not registered, ACL denied, OS relaunch failure),
  // the banner must (a) log the failure via `warn(...)` so it is captured
  // in the local log, and (b) surface a manual-relaunch fallback instead
  // of leaving the user staring at a dead "Restart Now" button. This is
  // the user-visible symptom of the macOS auto-update bug fixed by this
  // commit.
  it("surfaces a manual-relaunch fallback (and logs warn) when restartApp rejects", async () => {
    vi.mocked(restartApp).mockRejectedValueOnce(new Error("plugin not found"));
    useStore.setState({ updateStatus: "ready", updateVersion: "1.0.0" });
    render(<UpdateBanner />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Restart Now" }));
    expect(await screen.findByTestId("update-banner-fallback")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Restart Now" })).not.toBeInTheDocument();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("UpdateBanner: restartApp failed")
    );
  });

  it("dismiss button on the fallback UI resets status to idle", async () => {
    vi.mocked(restartApp).mockRejectedValueOnce(new Error("plugin not found"));
    useStore.setState({ updateStatus: "ready", updateVersion: "1.0.0" });
    render(<UpdateBanner />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Restart Now" }));
    await screen.findByTestId("update-banner-fallback");
    await user.click(screen.getByRole("button", { name: "Dismiss update" }));
    expect(useStore.getState().updateStatus).toBe("idle");
  });

  // Regression guard for the rubber-duck "blocking #1" finding: the banner
  // is mounted for the entire app lifetime (not conditionally rendered in
  // App.tsx), so a sticky `restartFailed` flag would carry over from one
  // failed update into the next available update in the same session and
  // permanently hide the "Restart Now" button. Drive the full state cycle
  // and prove the button comes back.
  it("recovers the Restart Now button on a subsequent ready transition after an earlier failure", async () => {
    vi.mocked(restartApp).mockRejectedValueOnce(new Error("plugin not found"));
    useStore.setState({ updateStatus: "ready", updateVersion: "1.0.0" });
    const { rerender } = render(<UpdateBanner />);
    const user = userEvent.setup();
    // Step 1 — first ready cycle, restart fails, fallback shows.
    await user.click(screen.getByRole("button", { name: "Restart Now" }));
    await screen.findByTestId("update-banner-fallback");
    expect(screen.queryByRole("button", { name: "Restart Now" })).not.toBeInTheDocument();
    // Step 2 — user dismisses, store goes idle, fallback unmounts.
    await user.click(screen.getByRole("button", { name: "Dismiss update" }));
    rerender(<UpdateBanner />);
    expect(screen.queryByTestId("update-banner-fallback")).not.toBeInTheDocument();
    // Step 3 — a later check finds another update on a NEW version and
    // lands on `ready` again. The button MUST be live; the previous
    // failure on v1.0.0 must not suppress restart for v1.1.0. The
    // version-keyed `failedVersion` makes this derived state. `act(...)`
    // wraps the external store transition so React flushes the resulting
    // re-render synchronously inside the test.
    act(() => {
      useStore.setState({ updateStatus: "ready", updateVersion: "1.1.0" });
    });
    rerender(<UpdateBanner />);
    expect(screen.queryByTestId("update-banner-fallback")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restart Now" })).toBeInTheDocument();
  });

  // Sibling regression to the recovery test: when the SAME version is
  // re-presented as ready (e.g. user dismissed without restarting and the
  // next periodic check re-detects the already-staged bundle), the
  // fallback MUST stay because the IPC failure is not transient — the
  // plugin/ACL situation is identical and `restartApp()` would reject
  // again. Version-keyed `failedVersion` encodes exactly this semantic.
  it("keeps the fallback when the same version is re-presented as ready after a failure", async () => {
    vi.mocked(restartApp).mockRejectedValueOnce(new Error("plugin not found"));
    useStore.setState({ updateStatus: "ready", updateVersion: "1.0.0" });
    const { rerender } = render(<UpdateBanner />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Restart Now" }));
    await screen.findByTestId("update-banner-fallback");
    await user.click(screen.getByRole("button", { name: "Dismiss update" }));
    rerender(<UpdateBanner />);
    act(() => {
      useStore.setState({ updateStatus: "ready", updateVersion: "1.0.0" });
    });
    rerender(<UpdateBanner />);
    expect(screen.getByTestId("update-banner-fallback")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Restart Now" })).not.toBeInTheDocument();
  });
});
