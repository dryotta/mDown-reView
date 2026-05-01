import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { WelcomeView } from "@/components/WelcomeView";
import { useStore } from "@/store/index";

vi.mock("@/lib/tauri-commands", () => ({
  checkPathExists: vi.fn().mockResolvedValue("file"),
}));

const initialState = useStore.getState();

beforeEach(() => {
  useStore.setState(initialState, true);
});

describe("WelcomeView", () => {
  it("renders Open File and Open Folder actions", () => {
    render(<WelcomeView onOpenFile={vi.fn()} onOpenFolder={vi.fn()} />);
    expect(screen.getByText("Open File")).toBeInTheDocument();
    expect(screen.getByText("Open Folder")).toBeInTheDocument();
  });

  it("shows keyboard shortcuts", () => {
    render(<WelcomeView onOpenFile={vi.fn()} onOpenFolder={vi.fn()} />);
    expect(screen.getByText("Ctrl+O")).toBeInTheDocument();
    expect(screen.getByText("Ctrl+Shift+O")).toBeInTheDocument();
  });

  it("calls onOpenFile when Open File is clicked", () => {
    const onOpenFile = vi.fn();
    render(<WelcomeView onOpenFile={onOpenFile} onOpenFolder={vi.fn()} />);
    fireEvent.click(screen.getByText("Open File"));
    expect(onOpenFile).toHaveBeenCalledOnce();
  });

  it("calls onOpenFolder when Open Folder is clicked", () => {
    const onOpenFolder = vi.fn();
    render(<WelcomeView onOpenFile={vi.fn()} onOpenFolder={onOpenFolder} />);
    fireEvent.click(screen.getByText("Open Folder"));
    expect(onOpenFolder).toHaveBeenCalledOnce();
  });

  it("hides recent section when no recent items", () => {
    render(<WelcomeView onOpenFile={vi.fn()} onOpenFolder={vi.fn()} />);
    expect(screen.queryByText("Recent")).not.toBeInTheDocument();
  });

  it("shows recent items when they exist in store", async () => {
    useStore.getState().addRecentItem("/docs/readme.md", "file");
    useStore.getState().addRecentItem("/workspace/project", "folder");
    render(<WelcomeView onOpenFile={vi.fn()} onOpenFolder={vi.fn()} />);
    expect(screen.getByText("Recent")).toBeInTheDocument();
    expect(screen.getByText(/readme\.md/)).toBeInTheDocument();
    expect(screen.getByText(/project/)).toBeInTheDocument();
    // Wait for async checkPathExists effect to settle
    await waitFor(() => {});
  });
});
