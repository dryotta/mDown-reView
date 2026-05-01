import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useStore } from "@/store";
import { WelcomeView } from "@/components/WelcomeView";

vi.mock("@/hooks/useRecentItemStatus", () => ({
  useRecentItemStatus: () => ({}),
}));

const initialState = useStore.getState();

beforeEach(() => {
  useStore.setState(initialState, true);
});

describe("WelcomeView – settings link (B11)", () => {
  it("renders a Settings link that calls openSettings on click", () => {
    const openSettings = vi.fn();
    useStore.setState({ openSettings } as Partial<ReturnType<typeof useStore.getState>>);

    render(
      <WelcomeView
        onOpenFile={() => {}}
        onOpenFolder={() => {}}
        onOpenRecentFolder={() => {}}
      />,
    );

    const link = screen.getByRole("button", {
      name: /Set up CLI, file associations, and agent integration → Settings/i,
    });
    fireEvent.click(link);

    expect(openSettings).toHaveBeenCalledOnce();
  });
});

describe("WelcomeView – recent-folder click delegates to onOpenRecentFolder", () => {
  it("calls onOpenRecentFolder with the recent folder path (not setRoot directly)", () => {
    // Bug regression: WelcomeView previously called setRoot BEFORE
    // registerWindowFolder, so clicking a recent folder already open
    // in another window cloned it into the current window instead of
    // activating the existing window. The fix moves the IPC + state
    // mutation into the shared `useDialogActions().openFolderPath`
    // callback, passed as `onOpenRecentFolder`. This test pins the
    // delegation so a future refactor cannot regress.
    useStore.setState({
      recentItems: [{ path: "/tmp/some-folder", type: "folder", timestamp: 1 }],
    } as Partial<ReturnType<typeof useStore.getState>>);
    const onOpenRecentFolder = vi.fn();

    render(
      <WelcomeView
        onOpenFile={() => {}}
        onOpenFolder={() => {}}
        onOpenRecentFolder={onOpenRecentFolder}
      />,
    );

    const item = screen.getByRole("button", { name: /some-folder/ });
    fireEvent.click(item);

    expect(onOpenRecentFolder).toHaveBeenCalledExactlyOnceWith("/tmp/some-folder");
  });

  it("does NOT call onOpenRecentFolder for recent file clicks", () => {
    // File items go through the existing openFile flow; only folder
    // items delegate to the shared register-then-setRoot callback.
    useStore.setState({
      recentItems: [{ path: "/tmp/notes.md", type: "file", timestamp: 1 }],
    } as Partial<ReturnType<typeof useStore.getState>>);
    const onOpenRecentFolder = vi.fn();

    render(
      <WelcomeView
        onOpenFile={() => {}}
        onOpenFolder={() => {}}
        onOpenRecentFolder={onOpenRecentFolder}
      />,
    );

    const item = screen.getByRole("button", { name: /notes\.md/ });
    fireEvent.click(item);

    expect(onOpenRecentFolder).not.toHaveBeenCalled();
  });
});
