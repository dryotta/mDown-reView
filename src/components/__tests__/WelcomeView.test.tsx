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

    render(<WelcomeView onOpenFile={() => {}} onOpenFolder={() => {}} />);

    const link = screen.getByRole("button", {
      name: /Set up CLI, file associations, and agent integration → Settings/i,
    });
    fireEvent.click(link);

    expect(openSettings).toHaveBeenCalledOnce();
  });
});

describe("WelcomeView – recent-item clicks delegate to workspace slice", () => {
  // Bug-2 regression guard: WelcomeView previously inlined its own
  // setRoot + addRecentItem + registerWindowFolder triple in the wrong
  // order, drifting from the toolbar's flow. The fix routes recent
  // clicks through the slice's single canonical entry points
  // (`openFolderPath` / `openFilePath`) so a future drift is
  // structurally impossible.
  it("recent-folder click calls openFolderPath with the path", () => {
    const openFolderPath = vi.fn();
    useStore.setState({
      recentItems: [{ path: "/tmp/some-folder", type: "folder", timestamp: 1 }],
      openFolderPath,
    } as Partial<ReturnType<typeof useStore.getState>>);

    render(<WelcomeView onOpenFile={() => {}} onOpenFolder={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /some-folder/ }));

    expect(openFolderPath).toHaveBeenCalledExactlyOnceWith("/tmp/some-folder");
  });

  it("recent-file click calls openFilePath (not openFolderPath)", () => {
    const openFolderPath = vi.fn();
    const openFilePath = vi.fn();
    useStore.setState({
      recentItems: [{ path: "/tmp/notes.md", type: "file", timestamp: 1 }],
      openFolderPath,
      openFilePath,
    } as Partial<ReturnType<typeof useStore.getState>>);

    render(<WelcomeView onOpenFile={() => {}} onOpenFolder={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /notes\.md/ }));

    expect(openFilePath).toHaveBeenCalledExactlyOnceWith("/tmp/notes.md");
    expect(openFolderPath).not.toHaveBeenCalled();
  });
});
